export const TELEGRAM_MESSAGE_LIMIT = 4_096;
export const TELEGRAM_RICH_MESSAGE_LIMIT = 32_768;

export function splitTelegramMessage(
  message: string,
  limit = TELEGRAM_RICH_MESSAGE_LIMIT,
): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("Message limit must be an integer >= 2");
  if (message.length <= limit) return [message];

  const chunks: string[] = [];
  let remaining = message;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const minimumNaturalBreak = Math.floor(limit * 0.5);
    // Prefer whole paragraphs so ordinary tables and code blocks stay together.
    let splitAt = window.lastIndexOf("\n\n", limit - 2) + 2;

    if (splitAt < 2) {
      splitAt = window.lastIndexOf("\n", limit - 1) + 1;
      if (splitAt < minimumNaturalBreak) splitAt = window.lastIndexOf(" ", limit - 1) + 1;
      if (splitAt < minimumNaturalBreak) splitAt = limit;
    }
    // Telegram counts characters; UTF-16 slicing must not cut an emoji in half.
    if (/[\uD800-\uDBFF]/.test(remaining[splitAt - 1]!)) splitAt--;

    const chunk = remaining.slice(0, splitAt);
    if (chunk.trim()) chunks.push(chunk);
    remaining = remaining.slice(splitAt);
  }

  if (remaining.trim()) chunks.push(remaining);
  return chunks;
}
