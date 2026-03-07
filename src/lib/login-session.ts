import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";
import { errorMessage } from "./errors.ts";
import { formatProviderName, normalizeProvider, type AIProvider } from "../ai/provider.ts";
import { getProviderAuthStatus } from "../ai/auth.ts";

const LOGIN_TIMEOUT_MS = 20 * 60 * 1000;
const CODEX_URL_RE = /https:\/\/auth\.openai\.com\/codex\/device/;
const CODEX_CODE_RE = /\b[A-Z0-9]{4,5}-[A-Z0-9]{5}\b/;
const ANSI_RE = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])",
  "g",
);

type LoginNotifier = (text: string) => Promise<void>;

interface ActiveLoginSession {
  provider: AIProvider;
  process: ChildProcessWithoutNullStreams;
  timeout: ReturnType<typeof setTimeout>;
  output: string;
  url?: string;
  code?: string;
  promptSent: boolean;
  completed: boolean;
}

let notifier: LoginNotifier | null = null;
let activeSession: ActiveLoginSession | null = null;

export function setLoginNotifier(send: LoginNotifier): void {
  notifier = send;
}

function cleanOutput(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(/\^D/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCommand(provider: AIProvider): { cmd: string; args: string[] } {
  if (provider === "claudecode") {
    return {
      cmd: "script",
      args: ["-q", "/dev/null", "zsh", "-lc", "claude setup-token"],
    };
  }

  return {
    cmd: "codex",
    args: ["login", "--device-auth"],
  };
}

function extractClaudeLoginUrl(output: string): string | undefined {
  const start = output.indexOf("https://claude.ai/oauth/authorize?");
  if (start < 0) return undefined;

  const rest = output.slice(start);
  const untilPrompt = rest.split("Paste code here if prompted")[0] ?? rest;
  const collapsed = untilPrompt.replace(/\s+/g, "");
  return collapsed || undefined;
}

async function notify(text: string): Promise<void> {
  if (!notifier) {
    logger.warn("Login notifier not configured");
    return;
  }

  await notifier(text);
}

async function flushPromptIfReady(session: ActiveLoginSession): Promise<void> {
  if (session.promptSent) return;

  if (session.provider === "claudecode") {
    const url = extractClaudeLoginUrl(session.output);
    const waitingForCode = session.output.includes("Paste code here if prompted");
    if (!url) return;

    session.url = url;
    session.promptSent = true;
    await notify(
      [
        "Claude Code login started.",
        url,
        waitingForCode
          ? "After you authorize in the browser, if Claude Code asks for a code, send `/login_code <code>` here."
          : "Complete the browser flow. If Claude Code later asks for a code, send `/login_code <code>` here.",
        "Use `/login_cancel` to abort.",
      ].join("\n\n"),
    );
    return;
  }

  const url = session.output.match(CODEX_URL_RE)?.[0];
  const code = session.output.match(CODEX_CODE_RE)?.[0];
  if (!url || !code) return;

  session.url = url;
  session.code = code;
  session.promptSent = true;
  await notify(
    [
      "Codex login started.",
      `Open: ${url}`,
      `Enter this code: ${code}`,
      "After you finish the browser flow, wait here for confirmation. Use `/login_cancel` to abort.",
    ].join("\n\n"),
  );
}

function finishSession(): void {
  if (!activeSession) return;
  clearTimeout(activeSession.timeout);
  activeSession = null;
}

async function handleExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
  const session = activeSession;
  if (!session || session.completed) return;

  session.completed = true;

  const tail = session.output.split("\n").slice(-8).join("\n").trim();
  const providerName = formatProviderName(session.provider);

  if (code === 0) {
    await notify(`${providerName} login completed. You can continue using Rachel.`);
  } else if (signal === "SIGINT" || signal === "SIGTERM") {
    await notify(`${providerName} login cancelled.`);
  } else {
    const fallback = tail || `${providerName} login failed.`;
    await notify(`${providerName} login failed.\n\n${fallback}`);
  }

  finishSession();
}

function attachStream(session: ActiveLoginSession, stream: NodeJS.ReadableStream): void {
  stream.on("data", (chunk: Buffer | string) => {
    const cleaned = cleanOutput(String(chunk));
    if (!cleaned) return;
    session.output = cleanOutput(`${session.output}\n${cleaned}`);
    flushPromptIfReady(session).catch((error) => {
      logger.error("Failed to send login prompt", { error: errorMessage(error) });
    });
  });
}

export async function startLoginSession(providerArg?: string): Promise<string> {
  const provider = normalizeProvider(providerArg) ?? env.AI_PROVIDER;

  if (activeSession) {
    if (activeSession.provider === provider) {
      return `${formatProviderName(provider)} login is already in progress. Use /login_status or /login_cancel.`;
    }

    return `A ${formatProviderName(activeSession.provider)} login is already in progress. Cancel it first with /login_cancel.`;
  }

  const { cmd, args } = buildCommand(provider);
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      COLUMNS: "240",
      LINES: "60",
      TERM: process.env["TERM"] ?? "xterm-256color",
    },
  });

  const timeout = setTimeout(() => {
    if (!activeSession) return;
    activeSession.process.kill("SIGTERM");
  }, LOGIN_TIMEOUT_MS);

  activeSession = {
    provider,
    process: child,
    timeout,
    output: "",
    promptSent: false,
    completed: false,
  };

  attachStream(activeSession, child.stdout);
  attachStream(activeSession, child.stderr);

  child.on("error", async (error) => {
    logger.error("Login session process error", { error: errorMessage(error) });
    if (activeSession?.completed) return;
    await notify(`${formatProviderName(provider)} login failed to start.\n\n${errorMessage(error)}`);
    finishSession();
  });

  child.on("exit", (code, signal) => {
    handleExit(code, signal).catch((error) => {
      logger.error("Failed to handle login session exit", { error: errorMessage(error) });
    });
  });

  return `Starting ${formatProviderName(provider)} login...`;
}

export async function submitLoginCode(code: string): Promise<string> {
  const session = activeSession;
  if (!session) {
    return "No login is in progress.";
  }

  session.process.stdin.write(`${code.trim()}\n`);
  return `Sent code to ${formatProviderName(session.provider)} login flow.`;
}

export async function cancelLoginSession(): Promise<string> {
  const session = activeSession;
  if (!session) {
    return "No login is in progress.";
  }

  session.process.kill("SIGINT");
  return `Cancelling ${formatProviderName(session.provider)} login...`;
}

export async function getLoginStatusMessage(providerArg?: string): Promise<string> {
  const provider = normalizeProvider(providerArg) ?? env.AI_PROVIDER;
  const status = await getProviderAuthStatus(provider);
  const lines = [`${formatProviderName(provider)}: ${status.detail}`];

  if (activeSession) {
    const sameProvider = activeSession.provider === provider;
    lines.push(
      sameProvider
        ? `${formatProviderName(provider)} login is currently in progress.`
        : `${formatProviderName(activeSession.provider)} login is currently in progress.`,
    );
    if (sameProvider && activeSession.url) {
      lines.push(activeSession.url);
    }
    if (sameProvider && activeSession.code) {
      lines.push(`Code: ${activeSession.code}`);
    }
  }

  return lines.join("\n\n");
}
