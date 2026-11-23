import { env } from "../config/env.ts";
import { errorMessage } from "./errors.ts";
import { getMcpHub, type McpHub } from "./mcp-hub.ts";
import { beginConnectorOAuth, completeConnectorOAuth, OAUTH_PENDING_TTL_MS } from "./mcp-oauth.ts";
import {
  BUILTIN_CONNECTORS,
  clearPendingOAuth,
  DEFAULT_FLUSO_BASE_URL,
  isAllowedConnectorUrl,
  isHttpConnectorReady,
  loadConnectors,
  loadFlusoCredentials,
  loadOAuthState,
  normalizeConnectorName,
  saveFlusoCredentials,
  upsertConnector,
  type ConnectorSpec,
  type HttpConnectorSpec,
} from "./mcp-store.ts";

const FLUSO_ROUTED_APPS = new Set([
  "gmail",
  "slack",
  "google",
  "gcalendar",
  "calendar",
  "gdrive",
  "drive",
  "gdocs",
  "gsheets",
  "gslides",
]);

export function normalizeConnector(value?: string): string | null {
  return normalizeConnectorName(value);
}

function parseConnectArgs(raw?: string): { name: string; arg?: string } | null {
  const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const name = normalizeConnectorName(parts[0]);
  if (!name) return null;
  return { name, arg: parts[1] };
}

async function resolveOrRegisterSpec(
  sharedDir: string,
  name: string,
  explicitUrl?: string,
): Promise<ConnectorSpec> {
  const configured = await loadConnectors(sharedDir);
  const existing = configured[name];
  if (explicitUrl) {
    if (!isAllowedConnectorUrl(explicitUrl)) {
      throw new Error("Connector URL must start with https:// (or http://localhost / 127.0.0.1).");
    }
    const next: HttpConnectorSpec =
      existing?.type === "http"
        ? { ...existing, url: explicitUrl, enabled: true }
        : { type: "http", url: explicitUrl, enabled: true };
    return upsertConnector(sharedDir, name, next);
  }
  if (existing) return existing;
  const preset = BUILTIN_CONNECTORS[name];
  if (preset) return upsertConnector(sharedDir, name, preset);
  if (FLUSO_ROUTED_APPS.has(name)) {
    throw new Error(
      `${name} is accessed through the "fluso" connector (connect it inside Fluso Cloud instead of direct OAuth). Run /connector_status fluso to check Fluso.`,
    );
  }
  const presetNames = Object.keys(BUILTIN_CONNECTORS).join(", ");
  throw new Error(
    `Unknown connector "${name}". Built-in presets: ${presetNames}. Or register a custom Streamable HTTP MCP with:\n/connector_connect ${name} https://...`,
  );
}

export async function startConnectorSession(
  raw?: string,
  sharedDir = env.SHARED_FOLDER_PATH,
  hub: McpHub = getMcpHub(),
): Promise<string> {
  const parsed = parseConnectArgs(raw);
  if (!parsed) {
    return `Usage: /connector_connect <name> [https://mcp-url | fluso-token]\nBuilt-in presets: ${Object.keys(BUILTIN_CONNECTORS).join(", ")}`;
  }
  if (parsed.name === "fluso") {
    const existing = (await loadConnectors(sharedDir))["fluso"];
    const baseUrl =
      existing?.type === "fluso" ? existing.baseUrl : DEFAULT_FLUSO_BASE_URL;
    if (parsed.arg) {
      await saveFlusoCredentials(sharedDir, { baseUrl, token: parsed.arg });
    }
    await upsertConnector(sharedDir, "fluso", { type: "fluso", baseUrl, enabled: true });
    const { tools, apps } = await hub.probeConnector("fluso");
    const appSummary = apps?.length ? ` Connected Fluso apps: ${apps.join(", ")}.` : "";
    return `fluso is connected (${tools} tools) across Antigravity, Codex and Claude Code.${appSummary}`;
  }

  const spec = await resolveOrRegisterSpec(sharedDir, parsed.name, parsed.arg);
  if (spec.type === "fluso") {
    const { tools, apps } = await hub.probeConnector(parsed.name);
    const appSummary = apps?.length ? ` Connected Fluso apps: ${apps.join(", ")}.` : "";
    return `${parsed.name} is connected (${tools} tools) across Antigravity, Codex and Claude Code.${appSummary}`;
  }
  if (spec.noAuth || (spec.headers && Object.keys(spec.headers).length > 0)) {
    await hub.invalidate(parsed.name);
    const { tools } = await hub.probeConnector(parsed.name);
    return `${parsed.name} is connected (${tools} tools) across Antigravity, Codex and Claude Code.`;
  }
  await hub.invalidate(parsed.name);
  const flow = await beginConnectorOAuth(sharedDir, parsed.name, spec);
  if (flow.status === "authorized") {
    const { tools } = await hub.probeConnector(parsed.name);
    return `${parsed.name} is already authorized and connected (${tools} tools) across Antigravity, Codex and Claude Code.`;
  }
  return [
    `${parsed.name} authorization is ready (provider-agnostic; works on Antigravity, Codex and Claude Code).`,
    flow.authorizationUrl,
    `After approving, your browser will redirect to ${flow.redirectUri} (which may fail to load — that is expected). Copy the complete URL from the address bar and send:`,
    `/connector_callback <complete URL>`,
    `Use /connector_cancel ${parsed.name} to abort.`,
  ].join("\n\n");
}

async function findMatchingPending(
  sharedDir: string,
  callbackUrl: string,
): Promise<{ name: string; spec: HttpConnectorSpec } | null> {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl.trim());
  } catch {
    throw new Error("That is not a valid OAuth callback URL.");
  }
  const stateParam = parsed.searchParams.get("state");
  const connectors = await loadConnectors(sharedDir);
  const candidates: Array<{ name: string; spec: HttpConnectorSpec; stateMatch: boolean }> = [];
  for (const [name, spec] of Object.entries(connectors)) {
    if (spec.type !== "http") continue;
    const oauth = await loadOAuthState(sharedDir, name);
    if (!oauth.pending) continue;
    const expected = new URL(oauth.pending.redirectUri);
    if (expected.origin === parsed.origin && expected.pathname === parsed.pathname) {
      candidates.push({
        name,
        spec,
        stateMatch: Boolean(stateParam && stateParam === oauth.pending.state),
      });
    }
  }
  const exact = candidates.find((c) => c.stateMatch);
  if (exact) return { name: exact.name, spec: exact.spec };
  if (candidates.length === 1) return { name: candidates[0]!.name, spec: candidates[0]!.spec };
  const allPending: Array<{ name: string; spec: HttpConnectorSpec }> = [];
  for (const [name, spec] of Object.entries(connectors)) {
    if (spec.type !== "http") continue;
    const oauth = await loadOAuthState(sharedDir, name);
    if (oauth.pending && Date.now() - oauth.pending.createdAt <= OAUTH_PENDING_TTL_MS) {
      allPending.push({ name, spec });
    }
  }
  return allPending.length === 1 ? allPending[0]! : null;
}

export async function submitConnectorCallback(
  value?: string,
  sharedDir = env.SHARED_FOLDER_PATH,
  hub: McpHub = getMcpHub(),
): Promise<string> {
  if (!value?.trim()) return "Usage: /connector_callback <complete callback URL>";
  const match = await findMatchingPending(sharedDir, value);
  if (!match) return "No pending connector authorization matches that callback URL.";
  await completeConnectorOAuth(sharedDir, match.name, match.spec, value);
  await hub.invalidate(match.name);
  try {
    const { tools } = await hub.probeConnector(match.name);
    return `${match.name} is connected (${tools} tools) and available across Antigravity, Codex and Claude Code.`;
  } catch (error) {
    return `${match.name} OAuth tokens saved, but live tool check failed: ${errorMessage(error)}`;
  }
}

export async function cancelConnectorSession(
  options: { name?: string } = {},
  sharedDir = env.SHARED_FOLDER_PATH,
): Promise<string> {
  const connectors = await loadConnectors(sharedDir);
  const target = options.name ? normalizeConnectorName(options.name) : null;
  if (options.name && !target) return `Invalid connector name: ${options.name}`;
  const names = target ? [target] : Object.keys(connectors);
  const cancelled: string[] = [];
  for (const name of names) {
    const state = await loadOAuthState(sharedDir, name);
    if (state.pending) {
      await clearPendingOAuth(sharedDir, name);
      cancelled.push(name);
    }
  }
  if (!cancelled.length) return "No connector authorization is pending.";
  return `Cancelled pending authorization for: ${cancelled.join(", ")}.`;
}

export async function getConnectorStatusMessage(
  value?: string,
  sharedDir = env.SHARED_FOLDER_PATH,
): Promise<string> {
  const requested = value?.trim() ? normalizeConnectorName(value) : null;
  if (value?.trim() && !requested) {
    return "Usage: /connector_status [connector-name]";
  }
  const connectors = await loadConnectors(sharedDir);
  const names = requested
    ? [requested]
    : [...new Set([...Object.keys(connectors), ...Object.keys(BUILTIN_CONNECTORS)])].sort();
  const lines: string[] = [];
  for (const name of names) {
    const spec = connectors[name];
    if (!spec) {
      lines.push(`${name}: preset available (run /connector_connect ${name})`);
      continue;
    }
    if (!spec.enabled) {
      lines.push(`${name} (${spec.type}): disabled`);
      continue;
    }
    if (spec.type === "fluso") {
      const creds = await loadFlusoCredentials(sharedDir);
      lines.push(
        creds?.token
          ? `${name} (fluso): developer token saved (Gmail, Slack, Google Workspace via Fluso Cloud)`
          : `${name} (fluso): token required (run /connector_connect fluso <token>)`,
      );
      continue;
    }
    const state = await loadOAuthState(sharedDir, name);
    if (isHttpConnectorReady(spec, state)) {
      const authKind = spec.noAuth
        ? "no auth"
        : spec.headers && Object.keys(spec.headers).length > 0
          ? "static headers"
          : state.tokens?.refresh_token
            ? "OAuth connected (refresh token saved)"
            : "OAuth connected";
      lines.push(`${name} (http): ${authKind}`);
    } else if (state.pending && Date.now() - state.pending.createdAt <= OAUTH_PENDING_TTL_MS) {
      lines.push(`${name} (http): authorization pending (send /connector_callback <URL>)`);
    } else {
      lines.push(`${name} (http): authorization required (run /connector_connect ${name})`);
    }
  }
  return lines.join("\n") || "No connectors configured.";
}
