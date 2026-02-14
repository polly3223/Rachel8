type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Read directly from process.env to avoid circular dependency with config module.
const currentLevel: LogLevel =
  (process.env["LOG_LEVEL"] as LogLevel | undefined) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

const CONSOLE_METHOD: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.log,
  warn: console.warn,
  error: console.error,
};

function logAtLevel(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const prefix = `[${level.toUpperCase()}]`;
  const write = CONSOLE_METHOD[level];
  if (ctx) {
    write(`${prefix} ${msg}`, ctx);
  } else {
    write(`${prefix} ${msg}`);
  }
}

export const logger = {
  debug(msg: string, ctx?: Record<string, unknown>): void { logAtLevel("debug", msg, ctx); },
  info(msg: string, ctx?: Record<string, unknown>): void  { logAtLevel("info", msg, ctx); },
  warn(msg: string, ctx?: Record<string, unknown>): void  { logAtLevel("warn", msg, ctx); },
  error(msg: string, ctx?: Record<string, unknown>): void { logAtLevel("error", msg, ctx); },
};
