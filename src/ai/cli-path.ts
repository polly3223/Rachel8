import type { AIProvider } from "./provider.ts";

const HOME = process.env["HOME"] ?? "";

function candidatePaths(provider: AIProvider): string[] {
  if (provider === "claudecode") {
    return [
      Bun.which("claude") ?? "",
      `${HOME}/.local/bin/claude`,
      `${HOME}/.bun/bin/claude`,
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
  }

  return [
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
  throw new Error(`Executable not found in standard locations for "${binary}"`);
}
