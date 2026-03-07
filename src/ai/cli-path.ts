import { env } from "../config/env.ts";
import type { AIProvider } from "./provider.ts";

const HOME = process.env["HOME"] ?? env.SHARED_FOLDER_PATH;

function candidatePaths(provider: AIProvider): string[] {
  if (provider === "claudecode") {
    return [
      process.env["CLAUDE_BIN"] ?? "",
      Bun.which("claude") ?? "",
      `${HOME}/.local/bin/claude`,
      `${HOME}/.bun/bin/claude`,
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
  }

  return [
    process.env["CODEX_BIN"] ?? "",
    Bun.which("codex") ?? "",
    `${HOME}/.local/bin/codex`,
    `${HOME}/.bun/bin/codex`,
    "/home/linuxbrew/.linuxbrew/bin/codex",
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
  ];
}

export async function resolveCliPath(provider: AIProvider): Promise<string> {
  for (const path of candidatePaths(provider)) {
    if (!path) continue;
    if (await Bun.file(path).exists()) {
      return path;
    }
  }

  const binary = provider === "claudecode" ? "claude" : "codex";
  throw new Error(`Executable not found in $PATH: "${binary}"`);
}
