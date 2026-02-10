/**
 * API key format validators for the setup wizard.
 *
 * Each validator returns `undefined` on success or a descriptive error string
 * on failure. These are used by @clack/prompts `validate` option and can be
 * called standalone for programmatic checks.
 *
 * Format-check only -- no live API calls (user decision).
 */

const TELEGRAM_TOKEN_RE = /^\d{8,}:[A-Za-z0-9_-]{35,}$/;

export function validateTelegramToken(
  value: string | undefined,
): string | undefined {
  if (!value || value.length === 0) return "Bot token is required";
  if (!TELEGRAM_TOKEN_RE.test(value)) {
    return 'Invalid format. Telegram tokens look like 123456789:ABCdef... (get one from @BotFather)';
  }
  return undefined;
}

export function validateExaKey(
  value: string | undefined,
): string | undefined {
  if (!value || value.length === 0) return "API key is required";
  if (value.length < 10) {
    return "Invalid format. Exa API keys are at least 10 characters";
  }
  return undefined;
}

export function validateOwnerUserId(
  value: string | undefined,
): string | undefined {
  if (!value || value.length === 0) return "User ID is required";
  if (!/^\d+$/.test(value)) return "Must be a number. Send /start to @userinfobot on Telegram";
  const num = Number(value);
  if (num <= 0 || !Number.isInteger(num)) return "Must be a positive integer";
  return undefined;
}

export function validateFolderPath(
  value: string | undefined,
): string | undefined {
  if (!value || value.length === 0) return "Folder path is required";
  if (!value.startsWith("/")) {
    return "Path must be absolute (start with /)";
  }
  return undefined;
}
