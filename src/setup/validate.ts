const TELEGRAM_TOKEN_RE = /^\d{8,}:[A-Za-z0-9_-]{35,}$/;

export function validateTelegramToken(
  value: string | undefined,
): string | undefined {
  if (!value) return "Bot token is required";
  if (!TELEGRAM_TOKEN_RE.test(value)) {
    return 'Invalid format. Telegram tokens look like 123456789:ABCdef... (get one from @BotFather)';
  }
  return undefined;
}

export function validateOwnerUserId(
  value: string | undefined,
): string | undefined {
  if (!value) return "User ID is required";
  if (!/^\d+$/.test(value)) return "Must be a number. Send /start to @userinfobot on Telegram";
  if (value === "0") return "Must be a positive integer";
  return undefined;
}

export function validateFolderPath(
  value: string | undefined,
): string | undefined {
  if (!value) return "Folder path is required";
  if (!value.startsWith("/")) {
    return "Path must be absolute (start with /)";
  }
  return undefined;
}
