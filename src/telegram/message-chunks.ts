export const TELEGRAM_MESSAGE_LIMIT = 4_096;

export function splitTelegramMessage(
  message: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  if (message.length <= limit) return [message];

  const chunks: string[] = [];
  let remaining = message;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const minimumNaturalBreak = Math.floor(limit * 0.5);
    let splitAt = window.lastIndexOf("\n", limit);

    if (splitAt < minimumNaturalBreak) {
      splitAt = window.lastIndexOf(" ", limit);
    }
    if (splitAt < minimumNaturalBreak) {
      splitAt = limit;
    }

    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
