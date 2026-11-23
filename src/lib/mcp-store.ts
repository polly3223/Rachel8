import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const CONNECTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const RESERVED_CONNECTOR_NAMES = new Set(["rachel"]);
export const DEFAULT_FLUSO_BASE_URL = "https://api.fluso.ai/v1";

export const oauthConfigSchema = z.object({
  redirectUri: z.url().optional(),
  scope: z.string().min(1).optional(),
});

export type OAuthConfig = z.infer<typeof oauthConfigSchema>;

export function isAllowedConnectorUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

const allowedUrlSchema = z.url().refine(isAllowedConnectorUrl, {
  message: "Connector URL must use https:// (or http://localhost / 127.0.0.1)",
});

export const httpConnectorSchema = z.object({
  type: z.literal("http"),
  url: allowedUrlSchema,
  enabled: z.boolean().default(true),
  headers: z.record(z.string(), z.string()).optional(),
  noAuth: z.boolean().optional(),
  oauth: oauthConfigSchema.optional(),
});

export const flusoConnectorSchema = z.object({
  type: z.literal("fluso"),
  baseUrl: allowedUrlSchema.default(DEFAULT_FLUSO_BASE_URL),
  enabled: z.boolean().default(true),
});

export const connectorSpecSchema = z.discriminatedUnion("type", [
  httpConnectorSchema,
  flusoConnectorSchema,
]);

export type HttpConnectorSpec = z.infer<typeof httpConnectorSchema>;
export type FlusoConnectorSpec = z.infer<typeof flusoConnectorSchema>;
export type ConnectorSpec = z.infer<typeof connectorSpecSchema>;

const connectorsFileSchema = z.object({
  connectors: z.record(z.string(), connectorSpecSchema).default({}),
});

export const flusoCredentialsSchema = z.object({
  baseUrl: allowedUrlSchema.default(DEFAULT_FLUSO_BASE_URL),
  token: z.string().min(1),
});

export type FlusoCredentials = z.infer<typeof flusoCredentialsSchema>;

export const pendingOAuthSchema = z.object({
  state: z.string().min(1),
  redirectUri: z.url(),
  authorizationUrl: z.url(),
  createdAt: z.number().int().positive(),
});

export type PendingOAuth = z.infer<typeof pendingOAuthSchema>;

export const oauthTokensSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().default("Bearer"),
    expires_in: z.number().optional(),
    scope: z.string().optional(),
    refresh_token: z.string().optional(),
  })
  .loose();

export const oauthStateSchema = z.object({
  clientInfo: z.record(z.string(), z.unknown()).optional(),
  tokens: oauthTokensSchema.optional(),
  expiresAt: z.number().optional(),
  codeVerifier: z.string().optional(),
  discoveryState: z.record(z.string(), z.unknown()).optional(),
  pending: pendingOAuthSchema.optional(),
});

export type OAuthState = z.infer<typeof oauthStateSchema>;

export const BUILTIN_CONNECTORS: Record<string, ConnectorSpec> = {
  linear: { type: "http", url: "https://mcp.linear.app/mcp", enabled: true },
  atlassian: { type: "http", url: "https://mcp.atlassian.com/v2/mcp", enabled: true },
  attio: { type: "http", url: "https://mcp.attio.com/mcp", enabled: true },
  posthog: { type: "http", url: "https://mcp.posthog.com/mcp", enabled: true },
  fluso: { type: "fluso", baseUrl: DEFAULT_FLUSO_BASE_URL, enabled: true },
};

export function normalizeConnectorName(value?: string): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !CONNECTOR_NAME_RE.test(normalized) || RESERVED_CONNECTOR_NAMES.has(normalized))
    return null;
  return normalized;
}

export function mcpVaultDir(sharedDir: string): string {
  return join(sharedDir, "vault", "mcp");
}

export function connectorsFilePath(sharedDir: string): string {
  return join(mcpVaultDir(sharedDir), "connectors.json");
}

export function flusoCredentialsPath(sharedDir: string): string {
  return join(mcpVaultDir(sharedDir), "fluso.json");
}

export function oauthStatePath(sharedDir: string, name: string): string {
  const safe = normalizeConnectorName(name);
  if (!safe) throw new Error(`Invalid connector name: ${name}`);
  return join(mcpVaultDir(sharedDir), "oauth", `${safe}.json`);
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`Refusing symlinked vault file: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}

async function readVaultJson(path: string): Promise<unknown | null> {
  await assertNotSymlink(path);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeVaultJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  await assertNotSymlink(path);
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export async function loadConnectors(sharedDir: string): Promise<Record<string, ConnectorSpec>> {
  const raw = await readVaultJson(connectorsFilePath(sharedDir));
  if (!raw) return {};
  const parsed = connectorsFileSchema.parse(raw);
  const out: Record<string, ConnectorSpec> = {};
  for (const [key, spec] of Object.entries(parsed.connectors)) {
    const safe = normalizeConnectorName(key);
    if (safe) out[safe] = spec;
  }
  return out;
}

export async function saveConnectors(
  sharedDir: string,
  connectors: Record<string, ConnectorSpec>,
): Promise<void> {
  await writeVaultJson(connectorsFilePath(sharedDir), { connectors });
}

export async function upsertConnector(
  sharedDir: string,
  name: string,
  spec: ConnectorSpec,
): Promise<ConnectorSpec> {
  const safe = normalizeConnectorName(name);
  if (!safe) throw new Error(`Invalid connector name: ${name}`);
  const validated = connectorSpecSchema.parse(spec);
  const all = await loadConnectors(sharedDir);
  all[safe] = validated;
  await saveConnectors(sharedDir, all);
  return validated;
}

export async function loadFlusoCredentials(sharedDir: string): Promise<FlusoCredentials | null> {
  const raw = await readVaultJson(flusoCredentialsPath(sharedDir));
  if (!raw) return null;
  return flusoCredentialsSchema.parse(raw);
}

export async function saveFlusoCredentials(
  sharedDir: string,
  creds: FlusoCredentials,
): Promise<void> {
  await writeVaultJson(flusoCredentialsPath(sharedDir), flusoCredentialsSchema.parse(creds));
}

export async function loadOAuthState(sharedDir: string, name: string): Promise<OAuthState> {
  const raw = await readVaultJson(oauthStatePath(sharedDir, name));
  if (!raw) return {};
  return oauthStateSchema.parse(raw);
}

export async function saveOAuthState(
  sharedDir: string,
  name: string,
  state: OAuthState,
): Promise<void> {
  await writeVaultJson(oauthStatePath(sharedDir, name), oauthStateSchema.parse(state));
}

export async function clearPendingOAuth(sharedDir: string, name: string): Promise<void> {
  const current = await loadOAuthState(sharedDir, name);
  if (!current.pending) return;
  const { pending: _, ...rest } = current;
  await saveOAuthState(sharedDir, name, rest);
}

export async function deleteOAuthState(sharedDir: string, name: string): Promise<void> {
  await unlink(oauthStatePath(sharedDir, name)).catch(() => {});
}

export function isHttpConnectorReady(spec: HttpConnectorSpec, state: OAuthState): boolean {
  if (!spec.enabled) return false;
  if (spec.noAuth) return true;
  if (spec.headers && Object.keys(spec.headers).length > 0) return true;
  return Boolean(state.tokens?.access_token);
}
