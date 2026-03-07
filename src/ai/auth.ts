import { env } from "../config/env.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatProviderName, type AIProvider } from "./provider.ts";

class CommandFailure extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export class ProviderAuthError extends Error {
  constructor(
    readonly provider: AIProvider,
    detail?: string,
  ) {
    const providerName = formatProviderName(provider);
    super(
      `${providerName} is logged out. Run /login to reconnect.${detail ? ` ${detail}` : ""}`.trim(),
    );
  }
}

async function runCommand(
  cmd: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function runCommandOrThrow(cmd: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await runCommand(cmd);

  if (exitCode !== 0) {
    const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
    throw new CommandFailure(detail || `${cmd.join(" ")} failed`, stdout, stderr, exitCode);
  }

  return stdout;
}

async function assertClaudeAuthenticated(): Promise<void> {
  try {
    const stdout = await runCommandOrThrow(["claude", "auth", "status"]);
    const parsed = JSON.parse(stdout) as { loggedIn?: boolean };
    if (!parsed.loggedIn) {
      throw new ProviderAuthError("claudecode");
    }
  } catch (error) {
    if (error instanceof ProviderAuthError) {
      throw error;
    }

    const msg = errorMessage(error).toLowerCase();
    if (msg.includes("not logged in") || msg.includes("run /login")) {
      throw new ProviderAuthError("claudecode");
    }

    throw error;
  }
}

async function assertCodexAuthenticated(): Promise<void> {
  const { stdout, stderr, exitCode } = await runCommand(["codex", "login", "status"]);
  const combined = `${stdout}\n${stderr}`.toLowerCase();

  if (exitCode !== 0 || combined.includes("not logged in")) {
    throw new ProviderAuthError("codex");
  }
}

export async function assertProviderAuthenticated(
  provider: AIProvider = env.AI_PROVIDER,
): Promise<void> {
  if (provider === "claudecode") {
    await assertClaudeAuthenticated();
    return;
  }

  await assertCodexAuthenticated();
}

export function isProviderAuthFailure(
  provider: AIProvider,
  error: unknown,
): boolean {
  if (error instanceof ProviderAuthError) {
    return true;
  }

  const msg = errorMessage(error).toLowerCase();

  if (provider === "claudecode") {
    return msg.includes("not logged in") || msg.includes("run /login");
  }

  return (
    msg.includes("not logged in") ||
    msg.includes("401 unauthorized") ||
    msg.includes("missing bearer or basic authentication")
  );
}

export async function getProviderAuthStatus(
  provider: AIProvider = env.AI_PROVIDER,
): Promise<{ provider: AIProvider; loggedIn: boolean; detail: string }> {
  if (provider === "claudecode") {
    const { stdout, stderr, exitCode } = await runCommand(["claude", "auth", "status"]);
    const detail = (stdout || stderr).trim();
    if (exitCode !== 0) {
      return { provider, loggedIn: false, detail };
    }

    try {
      const parsed = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
      const suffix = parsed.email ? ` (${parsed.email})` : "";
      return {
        provider,
        loggedIn: parsed.loggedIn === true,
        detail: parsed.loggedIn === true ? `Logged in${suffix}` : "Not logged in",
      };
    } catch {
      return {
        provider,
        loggedIn: !detail.toLowerCase().includes("not logged in"),
        detail,
      };
    }
  }

  const { stdout, stderr, exitCode } = await runCommand(["codex", "login", "status"]);
  const detail = (stdout || stderr).trim();
  return {
    provider,
    loggedIn: exitCode === 0 && !detail.toLowerCase().includes("not logged in"),
    detail,
  };
}
