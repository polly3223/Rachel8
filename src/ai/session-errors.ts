export function isContextOverflowError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "context window",
    "context length",
    "maximum context",
    "too many tokens",
    "prompt is too long",
    "request too large",
  ].some((pattern) => normalized.includes(pattern));
}

export function isCodexThreadUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "thread_not_found",
    "invalid thread id",
    "thread has expired",
    "thread cannot be resumed",
    "failed to resume thread",
    "thread not found",
    "no thread found",
  ].some((pattern) => normalized.includes(pattern));
}
