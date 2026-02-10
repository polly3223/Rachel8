type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Read LOG_LEVEL from process.env directly — NOT from the env config module.
// Logger loads before config validation and must not create a circular dependency.
const currentLevel: LogLevel =
  (process.env["LOG_LEVEL"] as LogLevel | undefined) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export const logger = {
  debug(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog("debug")) {
      if (ctx) {
        console.debug(`[DEBUG] ${msg}`, ctx);
      } else {
        console.debug(`[DEBUG] ${msg}`);
      }
    }
  },

  info(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog("info")) {
      if (ctx) {
        console.log(`[INFO] ${msg}`, ctx);
      } else {
        console.log(`[INFO] ${msg}`);
      }
    }
  },

  warn(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog("warn")) {
      if (ctx) {
        console.warn(`[WARN] ${msg}`, ctx);
      } else {
        console.warn(`[WARN] ${msg}`);
      }
    }
  },

  error(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog("error")) {
      if (ctx) {
        console.error(`[ERROR] ${msg}`, ctx);
      } else {
        console.error(`[ERROR] ${msg}`);
      }
    }
  },
};
