import { mkdir, rename } from "node:fs/promises";
import type { AIProvider } from "../ai/provider.ts";
import { dirname, join } from "node:path";

export const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

type RuntimeSettings = {
  reasoningEffort?: ReasoningEffort;
};

export function parseReasoningEffort(value: string): ReasoningEffort | null {
  const normalized = value.trim().toLowerCase().replaceAll("-", "");
  if (normalized === "xhigh" || normalized === "extra high") return "xhigh";
  return REASONING_EFFORTS.find((effort) => effort === normalized) ?? null;
}

function settingsPath(sharedFolderPath: string, provider: AIProvider): string {
  return join(sharedFolderPath, "rachel-memory", provider === "antigravity" ? "antigravity-settings.json" : "runtime-settings.json");
}

async function readSettings(sharedFolderPath: string, provider: AIProvider): Promise<RuntimeSettings> {
  const file = Bun.file(settingsPath(sharedFolderPath, provider));
  if (!(await file.exists())) return {};

  try {
    const value: unknown = await file.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const effort = (value as RuntimeSettings).reasoningEffort;
    return effort && REASONING_EFFORTS.includes(effort) ? { reasoningEffort: effort } : {};
  } catch {
    return {};
  }
}

export async function getReasoningEffort(
  sharedFolderPath: string,
  fallback = "medium",
  provider: AIProvider = "codex",
): Promise<ReasoningEffort> {
  const settings = await readSettings(sharedFolderPath, provider);
  return settings.reasoningEffort ?? parseReasoningEffort(fallback) ?? "medium";
}

export async function setReasoningEffort(
  sharedFolderPath: string,
  effort: ReasoningEffort,
  provider: AIProvider = "codex",
): Promise<void> {
  if (provider === "antigravity" && (effort === "max" || effort === "ultra")) throw new Error("Neon supports low, medium, high and xhigh.");
  const path = settingsPath(sharedFolderPath, provider);
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const settings = await readSettings(sharedFolderPath, provider);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(temporaryPath, JSON.stringify({ ...settings, reasoningEffort: effort }, null, 2));
  await rename(temporaryPath, path);
}
