import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveCliPath } from "../ai/cli-path.ts";
import { errorMessage } from "./errors.ts";
import { logger } from "./logger.ts";
import { cleanTerminalOutput, outputTail } from "./terminal-output.ts";
import { LINEAR_MCP_NAME, LINEAR_MCP_URL } from "./connector-config.ts";

const CONNECTOR_TIMEOUT_MS = 20 * 60 * 1000;
const PLUGINS = {
  linear: "linear@openai-curated",
  slack: "slack@openai-curated",
} as const;

export type Connector = keyof typeof PLUGINS;
type ConnectorNotifier = (text: string) => Promise<void>;

interface ActiveConnectorSession {
  connector: Connector;
  process: ChildProcessWithoutNullStreams;
  timeout: ReturnType<typeof setTimeout>;
  output: string;
  authorizationUrl?: string;
  expectedCallback?: string;
  promptSent: boolean;
  completed: boolean;
}

let notifier: ConnectorNotifier | null = null;
let activeSession: ActiveConnectorSession | null = null;

export function normalizeConnector(value?: string): Connector | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "linear" || normalized === "slack" ? normalized : null;
}

export function setConnectorNotifier(send: ConnectorNotifier): void {
  notifier = send;
}

async function notify(text: string): Promise<void> {
  if (!notifier) {
    logger.warn("Connector notifier not configured");
    return;
  }
  await notifier(text);
}

async function runCommand(
  command: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout: cleanTerminalOutput(stdout), stderr: cleanTerminalOutput(stderr), exitCode };
  } finally {
    clearTimeout(timer);
  }
}

async function ensurePlugin(codex: string, connector: Connector): Promise<void> {
  const list = await runCommand([codex, "plugin", "list"]);
  const plugin = PLUGINS[connector];
  const installed = list.exitCode === 0 && new RegExp(`^${plugin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+installed`, "m").test(list.stdout);
  if (installed) return;

  const install = await runCommand([codex, "plugin", "add", plugin, "--json"], 120_000);
  if (install.exitCode !== 0) {
    throw new Error(outputTail(`${install.stdout}\n${install.stderr}`) || `Could not install ${plugin}`);
  }
}

async function isLinearMcpConfigured(codex: string): Promise<boolean> {
  const result = await runCommand([codex, "mcp", "get", LINEAR_MCP_NAME, "--json"]);
  return result.exitCode === 0;
}

export function extractLinearOAuthDetails(output: string): {
  authorizationUrl?: string;
  expectedCallback?: string;
} {
  const authorizationUrl = output.match(/https:\/\/mcp\.linear\.app\/authorize\?[^\s]+/)?.[0];
  if (!authorizationUrl) return {};

  try {
    const redirect = new URL(authorizationUrl).searchParams.get("redirect_uri");
    if (!redirect) return { authorizationUrl };
    const callback = new URL(redirect);
    return {
      authorizationUrl,
      expectedCallback: `${callback.origin}${callback.pathname}`,
    };
  } catch {
    return { authorizationUrl };
  }
}

export function validateLinearCallback(value: string, expectedCallback?: string): URL {
  const callback = new URL(value.trim());
  const localHost = callback.hostname === "127.0.0.1" || callback.hostname === "localhost";
  const hasResult = callback.searchParams.has("code") || callback.searchParams.has("error");
  if (callback.protocol !== "http:" || !localHost || !callback.port || !callback.pathname.startsWith("/callback/") || !hasResult) {
    throw new Error("That is not a valid Linear OAuth callback URL.");
  }
  if (expectedCallback && `${callback.origin}${callback.pathname}` !== expectedCallback) {
    throw new Error("That callback URL does not belong to the active Linear login.");
  }
  return callback;
}

export function slackProbeSucceeded(output: string): boolean {
  return output.split("\n").some((line) => {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; server?: string; tool?: string; status?: string; error?: unknown };
      };
      return event.type === "item.completed"
        && event.item?.type === "mcp_tool_call"
        && event.item.server === "codex_apps"
        && event.item.tool?.startsWith("slack.") === true
        && event.item.status === "completed"
        && event.item.error == null;
    } catch {
      return false;
    }
  });
}

function connectorEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COLUMNS: "240",
    LINES: "60",
    TERM: process.env["TERM"] ?? "xterm-256color",
  };
}

async function flushPromptIfReady(session: ActiveConnectorSession): Promise<void> {
  if (session.promptSent) return;

  if (session.connector === "linear") {
    const details = extractLinearOAuthDetails(session.output);
    if (!details.authorizationUrl) return;
    session.authorizationUrl = details.authorizationUrl;
    session.expectedCallback = details.expectedCallback;
    session.promptSent = true;
    await notify([
      "Linear authorization is ready.",
      details.authorizationUrl,
      "After approving, your browser may fail to open the localhost callback. Copy the complete URL from its address bar and send:",
      "/connector_callback <complete URL>",
      "Use /connector_cancel to abort.",
    ].join("\n\n"));
    return;
  }

  const oauthUrl = session.output.match(/https:\/\/(?:chatgpt\.com|auth\.openai\.com)\/[^\s"\\]+/)?.[0];
  if (!oauthUrl) return;
  session.authorizationUrl = oauthUrl;
  session.promptSent = true;
  await notify([
    "Slack authorization is ready.",
    oauthUrl,
    "Complete the browser flow, then wait here for confirmation. Use /connector_cancel to abort.",
  ].join("\n\n"));
}

function finishSession(session: ActiveConnectorSession): void {
  clearTimeout(session.timeout);
  if (activeSession === session) activeSession = null;
}

async function handleExit(
  session: ActiveConnectorSession,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  if (session.completed) return;
  session.completed = true;

  const succeeded = session.connector === "linear" || slackProbeSucceeded(session.output);
  if (code === 0 && succeeded) {
    await notify(`${session.connector === "linear" ? "Linear" : "Slack"} is connected and available to Rachel.`);
  } else if (code === 0 && session.authorizationUrl) {
    await notify("Slack authorization was opened. Run /connector_connect slack again after completing it to verify access.");
  } else if (signal === "SIGINT" || signal === "SIGTERM") {
    await notify(`${session.connector === "linear" ? "Linear" : "Slack"} connection cancelled.`);
  } else {
    const detail = outputTail(session.output, 12);
    await notify(`${session.connector === "linear" ? "Linear" : "Slack"} connection failed.${detail ? `\n\n${detail}` : ""}`);
  }
  finishSession(session);
}

function attachStream(session: ActiveConnectorSession, stream: NodeJS.ReadableStream): void {
  stream.on("data", (chunk: Buffer | string) => {
    session.output = cleanTerminalOutput(`${session.output}\n${String(chunk)}`);
    flushPromptIfReady(session).catch((error) => {
      logger.error("Failed to send connector OAuth prompt", { error: errorMessage(error) });
    });
  });
}

function spawnSession(connector: Connector, cmd: string, args: string[]): void {
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: connectorEnvironment(),
  });
  const session: ActiveConnectorSession = {
    connector,
    process: child,
    timeout: setTimeout(() => child.kill("SIGTERM"), CONNECTOR_TIMEOUT_MS),
    output: "",
    promptSent: false,
    completed: false,
  };
  activeSession = session;
  child.stdin.end();
  attachStream(session, child.stdout);
  attachStream(session, child.stderr);
  child.on("error", (error) => {
    logger.error("Connector process failed to start", { connector, error: errorMessage(error) });
    if (!session.completed) {
      session.completed = true;
      notify(`${connector === "linear" ? "Linear" : "Slack"} connection failed to start.\n\n${errorMessage(error)}`)
        .finally(() => finishSession(session));
    }
  });
  child.on("exit", (code, signal) => {
    handleExit(session, code, signal).catch((error) => {
      logger.error("Failed to handle connector process exit", { error: errorMessage(error) });
      finishSession(session);
    });
  });
}

export async function startConnectorSession(value?: string): Promise<string> {
  const connector = normalizeConnector(value);
  if (!connector) return "Usage: /connector_connect <linear|slack>";
  if (activeSession) {
    return `${activeSession.connector === "linear" ? "Linear" : "Slack"} connection is already in progress. Use /connector_status or /connector_cancel.`;
  }

  const codex = await resolveCliPath("codex");
  await ensurePlugin(codex, connector);
  if (connector === "linear") {
    // Register the exact loopback callback for Linear's redirect validation.
    if (await isLinearMcpConfigured(codex)) {
      spawnSession(connector, codex, [
        "mcp", "login", LINEAR_MCP_NAME, "--oauth-client-registration", "dcr",
      ]);
    } else {
      // `mcp add` starts OAuth immediately when the server advertises it, so
      // keep it inside the managed session instead of waiting synchronously.
      spawnSession(connector, codex, [
        "mcp",
        "add",
        LINEAR_MCP_NAME,
        "--url",
        LINEAR_MCP_URL,
        "--oauth-resource",
        LINEAR_MCP_URL,
        "--oauth-client-registration",
        "dcr",
      ]);
    }
  } else {
    const nonce = `rachel-connector-probe-${Date.now()}`;
    spawnSession(connector, codex, [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      `Use the installed Slack plugin to search Slack read-only for the exact impossible phrase \"${nonce}\". Do not write anything. If authentication is required, initiate its authorization flow.`,
    ]);
  }
  return `Starting ${connector === "linear" ? "Linear" : "Slack"} connection...`;
}

export async function submitConnectorCallback(value?: string): Promise<string> {
  const session = activeSession;
  if (!session || session.connector !== "linear") return "No Linear connection is waiting for a callback.";
  if (!value) return "Usage: /connector_callback <complete callback URL>";

  const callback = validateLinearCallback(value, session.expectedCallback);
  const response = await fetch(callback, { redirect: "manual" });
  if (!response.ok) throw new Error(`Linear callback relay failed with HTTP ${response.status}.`);
  return "Linear callback relayed. Waiting for Codex to confirm the connection...";
}

export async function cancelConnectorSession(options: { notify?: boolean } = {}): Promise<string> {
  const session = activeSession;
  if (!session) return "No connector connection is in progress.";
  if (options.notify === false) session.completed = true;
  session.process.kill("SIGINT");
  if (options.notify === false) finishSession(session);
  return `Cancelling ${session.connector === "linear" ? "Linear" : "Slack"} connection...`;
}

export async function getConnectorStatusMessage(value?: string): Promise<string> {
  const requested = value ? normalizeConnector(value) : null;
  if (value && !requested) return "Usage: /connector_status [linear|slack]";

  const codex = await resolveCliPath("codex");
  const [plugins, mcp] = await Promise.all([
    runCommand([codex, "plugin", "list"]),
    runCommand([codex, "mcp", "list"]),
  ]);
  const connectors: Connector[] = requested ? [requested] : ["linear", "slack"];
  const lines = connectors.map((connector) => {
    const plugin = PLUGINS[connector];
    const installed = new RegExp(`^${plugin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+installed`, "m").test(plugins.stdout);
    if (!installed) return `${connector === "linear" ? "Linear" : "Slack"}: not installed`;
    if (connector === "linear") {
      const row = mcp.stdout
        .split("\n")
        .find((line) => line.startsWith(`${LINEAR_MCP_NAME} `));
      const connected = row ? !/not logged in/i.test(row) : false;
      return `Linear: ${connected ? "connected" : "installed, authorization required"}`;
    }
    return "Slack: installed; run /connector_connect slack to verify authorization";
  });
  if (activeSession) lines.push(`${activeSession.connector === "linear" ? "Linear" : "Slack"} connection is in progress.`);
  return lines.join("\n");
}
