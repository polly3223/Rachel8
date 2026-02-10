import type { Context, NextFunction } from "grammy";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

export async function authGuard(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (userId !== env.OWNER_TELEGRAM_USER_ID) {
    logger.warn("Unauthorized access attempt", { userId });
    // Silent ignore — don't reveal bot exists to unauthorized users
    return;
  }

  await next();
}
