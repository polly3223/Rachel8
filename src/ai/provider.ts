export type AIProvider = "claudecode" | "codex";

export function normalizeProvider(value: string | undefined): AIProvider | null {
  if (value === "claudecode" || value === "claude") return "claudecode";
  if (value === "codex") return "codex";
  return null;
}

export function formatProviderName(provider: AIProvider): string {
  return provider === "claudecode" ? "Claude Code" : "Codex";
}
