export type AIProvider = "claudecode" | "codex" | "antigravity";

export function normalizeProvider(value: string | undefined): AIProvider | null {
  if (value === "claudecode" || value === "claude") return "claudecode";
  if (value === "codex" || value === "antigravity") return value;
  return null;
}

export function formatProviderName(provider: AIProvider): string {
  return { claudecode: "Claude Code", codex: "Codex", antigravity: "Antigravity" }[provider];
}
