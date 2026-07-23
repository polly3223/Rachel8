const CONTEXT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const DEFAULT_AGENT_TASK_CONTEXT = "shared";

export function parseAgentTaskContext(value: unknown): string {
  if (value === undefined) return DEFAULT_AGENT_TASK_CONTEXT;

  if (typeof value !== "string" || !CONTEXT_PATTERN.test(value)) {
    throw new Error(
      "Agent task context must be a lowercase slug of up to 64 characters",
    );
  }

  return value;
}
