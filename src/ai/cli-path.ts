import type { AIProvider } from "./provider.ts";

const userDirectory = process.env["HOME"] ?? "";

function candidatePaths(provider: AIProvider): string[] {
  const binary = { codex: "codex", claudecode: "claude", antigravity: "agy" }[provider];
  return [
    ...(provider === "codex" ? [`${import.meta.dir}/../../node_modules/.bin/codex`] : []),
    Bun.which(binary) ?? "",
    ...[".local/bin", ".bun/bin"].map((dir) => `${userDirectory}/${dir}/${binary}`),
    ...["/usr/local/bin", "/opt/homebrew/bin", "/home/linuxbrew/.linuxbrew/bin"].map((dir) => `${dir}/${binary}`),
  ];
}

export async function resolveCliPath(provider: AIProvider): Promise<string> {
  for (const path of candidatePaths(provider)) {
    if (!path) continue;
    if (await Bun.file(path).exists()) {
      return path;
    }
  }

  throw new Error(`Executable not found in standard locations for "${provider}"`);
}
