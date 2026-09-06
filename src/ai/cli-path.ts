import type { AIProvider } from "./provider.ts";

const userDirectory = process.env["HOME"] ?? "";

function candidatePaths(provider: AIProvider): string[] {
  if (provider === "claudecode") {
    return [
      Bun.which("claude") ?? "",
      `${userDirectory}/.local/bin/claude`,
      `${userDirectory}/.bun/bin/claude`,
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/home/linuxbrew/.linuxbrew/bin/claude",
    ];
  }

  return [
    `${import.meta.dir}/../../node_modules/.bin/codex`,
    Bun.which("codex") ?? "",
    `${userDirectory}/.local/bin/codex`,
    `${userDirectory}/.bun/bin/codex`,
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
