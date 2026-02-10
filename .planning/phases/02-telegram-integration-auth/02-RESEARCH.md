# Phase 2: Telegram Integration & Auth - Research

**Researched:** 2026-02-10
**Domain:** Telegram bot integration (grammY), single-user auth, typing indicators, basic AI responses
**Confidence:** HIGH

## Summary

Phase 2 connects Rachel to Telegram using grammY and adds single-user authentication. The phase covers three requirements: MSG-01 (send/receive text messages with intelligent responses), MSG-02 (typing indicator while processing), and SYS-01 (only owner's Telegram user ID can interact).

grammY is a mature TypeScript-first Telegram bot framework that supports both long polling and webhooks. **Long polling is the correct choice for Phase 2** -- it requires no HTTPS setup, no domain configuration, no webhook endpoint, and `bot.start()` keeps the process alive (replacing the current `setInterval` keepalive). Long polling is explicitly recommended by grammY's own documentation for most bots and is simpler to debug. Webhooks can be added later if needed but offer no advantage for a single-user bot on a dedicated VPS.

For "intelligent responses," Phase 2 should use the basic Anthropic SDK (`@anthropic-ai/sdk`) with `messages.create()`, not the Agent SDK. The Agent SDK (`@anthropic-ai/claude-agent-sdk`) is designed for autonomous tool-using agents (file operations, shell commands, code editing) -- that is Phase 3+ territory. The basic SDK provides simple request/response message generation which is exactly what Phase 2 needs.

**Primary recommendation:** Use grammY with long polling, `@anthropic-ai/sdk` for basic Claude responses, `@grammyjs/auto-chat-action` for typing indicators, and a simple middleware guard for single-user auth.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| grammy | latest (Bot API 9.4) | Telegram bot framework | TypeScript-first, native Bun support, active maintenance, best docs in Telegram bot ecosystem |
| @anthropic-ai/sdk | latest | Claude API client | Official Anthropic TypeScript SDK, simple `messages.create()` for text generation |
| @grammyjs/auto-chat-action | latest | Automatic typing indicators | Official grammY plugin, handles the 5-second typing indicator repeat loop automatically |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| grammy-middlewares | latest | Utility middlewares | Contains `ignoreOld()` for skipping stale updates after restart |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Long polling | Webhooks (`webhookCallback(bot, "bun")`) | Webhooks need HTTPS + domain + 10s timeout management. No benefit for single-user VPS bot. Switch later if needed. |
| @anthropic-ai/sdk | @anthropic-ai/claude-agent-sdk | Agent SDK is for autonomous tool-using agents (file ops, shell commands). Overkill for Phase 2 basic responses. Use in Phase 3. |
| @grammyjs/auto-chat-action | Manual `sendChatAction` loop | Plugin handles the complexity of repeating every 5s, stopping on completion, and supporting concurrent actions. No reason to hand-roll. |
| Custom auth middleware | grammy-middlewares `onlySuperAdmin()` | `onlySuperAdmin` is close but designed for group admin checks. Our auth is simpler -- just compare `ctx.from?.id` to env var. Custom middleware is 5 lines and more explicit. |

**Installation:**
```bash
bun add grammy @anthropic-ai/sdk @grammyjs/auto-chat-action
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── index.ts                 # Entry point: create bot, register middleware, start polling
├── config/
│   └── env.ts              # Existing — add OWNER_TELEGRAM_USER_ID
├── lib/
│   └── logger.ts           # Existing — no changes needed
├── telegram/
│   ├── bot.ts              # Bot instance creation and middleware registration
│   ├── handlers/
│   │   └── message.ts      # Text message handler (calls Claude, sends response)
│   └── middleware/
│       └── auth.ts         # Single-user auth guard
└── ai/
    └── claude.ts           # Anthropic SDK client, message generation
```

### Pattern 1: Long Polling with Graceful Shutdown
**What:** Use `bot.start()` for long polling. It keeps the process alive (replacing `setInterval` keepalive). Register `bot.stop()` on SIGTERM/SIGINT.
**When to use:** Always for Phase 2. Simplest deployment model.
**Source:** [grammY Deployment Types](https://grammy.dev/guide/deployment-types)
```typescript
// src/index.ts
import { bot } from "./telegram/bot.ts";
import { logger } from "./lib/logger.ts";

// Graceful shutdown — bot.stop() ends the long polling loop cleanly
process.once("SIGTERM", () => bot.stop());
process.once("SIGINT", () => bot.stop());

logger.info("Rachel8 starting...");
bot.start({
  onStart: () => logger.info("Rachel8 is running. Listening for messages..."),
});
```

### Pattern 2: Single-User Auth Middleware
**What:** Middleware that checks `ctx.from?.id` against the owner's Telegram user ID. Runs before all handlers.
**When to use:** Every incoming update must pass through this guard.
**Source:** [grammY Middleware Guide](https://grammy.dev/guide/middleware)
```typescript
// src/telegram/middleware/auth.ts
import { Context, NextFunction } from "grammy";
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
```

### Pattern 3: Typing Indicator with Auto-Chat-Action
**What:** The `@grammyjs/auto-chat-action` plugin automatically sends "typing..." indicator and repeats it every 5 seconds while the handler is processing.
**When to use:** Install globally so all handlers show typing while processing.
**Source:** [grammY auto-chat-action plugin](https://github.com/grammyjs/auto-chat-action)
```typescript
// src/telegram/bot.ts
import { Bot, Context } from "grammy";
import { autoChatAction, AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { authGuard } from "./middleware/auth.ts";
import { handleMessage } from "./handlers/message.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Middleware order matters: auth first, then typing indicator
bot.use(authGuard);
bot.use(autoChatAction());

// Register handlers
bot.on("message:text", handleMessage);

// Error handler
bot.catch((err) => {
  logger.error("Bot error", {
    updateId: err.ctx.update.update_id,
    error: err.error instanceof Error ? err.error.message : String(err.error),
  });
});
```

### Pattern 4: Basic Claude Response
**What:** Use `@anthropic-ai/sdk` to call `messages.create()` for generating responses. Simple request/response -- no agent loop, no tools.
**When to use:** Phase 2 only needs basic text generation. Agent SDK with tools comes in Phase 3.
**Source:** [Anthropic Client SDKs](https://platform.claude.com/docs/en/api/client-sdks)
```typescript
// src/ai/claude.ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly.`;

export async function generateResponse(userMessage: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock?.text ?? "I'm sorry, I couldn't generate a response.";
}
```

### Pattern 5: Message Handler
**What:** Receives text messages, calls Claude, sends response back.
**When to use:** All incoming text messages from authorized user.
```typescript
// src/telegram/handlers/message.ts
import { BotContext } from "../bot.ts";
import { generateResponse } from "../../ai/claude.ts";
import { logger } from "../../lib/logger.ts";

export async function handleMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  // Typing indicator is handled automatically by autoChatAction plugin
  ctx.chatAction = "typing";

  try {
    const response = await generateResponse(text);
    await ctx.reply(response);
  } catch (error) {
    logger.error("Failed to generate response", {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply("Sorry, I encountered an error. Please try again.");
  }
}
```

### Anti-Patterns to Avoid
- **Processing Claude API calls in webhook handler:** The 10-second webhook timeout will cause Telegram to resend updates, creating duplicates. This is not a concern with long polling, but matters if webhooks are added later.
- **Using Agent SDK for basic responses:** The Agent SDK (`@anthropic-ai/claude-agent-sdk`) spins up a full agent loop with tool execution. For Phase 2 text-only responses, this is massive overkill and slower.
- **Hardcoding owner user ID:** Always load from env. The user ID is a number that should be configured, not committed to source.
- **Not calling `await next()` in middleware:** grammY middleware MUST `await next()` to pass control downstream. Forgetting causes silent handler failures.
- **Using `process.on` instead of `process.once` for signals:** Using `.on` can cause multiple shutdown attempts. Always use `.once` for SIGTERM/SIGINT.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Typing indicator repeat loop | Custom `setInterval` to send `sendChatAction` every 5s | `@grammyjs/auto-chat-action` plugin | Plugin handles start/stop/repeat lifecycle, auto-stops on handler completion, handles errors gracefully |
| Telegram bot framework | Raw Telegram Bot API HTTP calls | grammY | Handles update parsing, middleware, error handling, retries, Bot API type safety |
| Claude API client | Raw HTTP calls to Anthropic API | `@anthropic-ai/sdk` | Handles auth, retries, streaming, type safety, error parsing |
| Stale update filtering | Manual timestamp comparison on each update | `ignoreOld()` from grammy-middlewares | Handles edge cases around bot restarts and update queue drain |

**Key insight:** Phase 2 is a thin integration layer. Every component has a well-maintained library. The only custom code needed is the auth middleware (5 lines), the message handler (connects bot to Claude), and the bot setup (wiring middleware + handlers).

## Common Pitfalls

### Pitfall 1: Telegram Typing Indicator Expires After 5 Seconds
**What goes wrong:** Bot shows "typing..." for 5 seconds then stops, even though Claude is still generating a response (which can take 10-30 seconds).
**Why it happens:** Telegram's `sendChatAction` only shows the indicator for 5 seconds maximum. It must be re-sent periodically.
**How to avoid:** Use `@grammyjs/auto-chat-action` plugin which handles the repeat loop automatically. Set `ctx.chatAction = "typing"` in handler and the plugin keeps it alive.
**Warning signs:** Users see "typing..." disappear before response arrives.

### Pitfall 2: Bot Processes Old Messages After Restart
**What goes wrong:** After a crash/restart, bot processes a backlog of messages that were sent while it was down, potentially hours old.
**Why it happens:** Telegram queues updates for up to 24 hours. Long polling retrieves them all on reconnect.
**How to avoid:** Use `ignoreOld()` middleware from `grammy-middlewares` to skip updates older than N seconds (e.g., 5 minutes). Place it early in the middleware stack.
**Warning signs:** After restart, bot suddenly replies to many old messages in rapid succession.

### Pitfall 3: Owner User ID as String vs Number
**What goes wrong:** Auth middleware never matches because user ID from Telegram is a `number` but env var is parsed as `string`.
**Why it happens:** All environment variables are strings. `ctx.from?.id` returns a `number`. `123456 !== "123456"` in JavaScript.
**How to avoid:** Parse `OWNER_TELEGRAM_USER_ID` as a number in the Zod env schema using `z.coerce.number()` or `z.string().transform(Number)`.
**Warning signs:** Owner can't use the bot. Auth logs show "unauthorized" for the correct user ID.

### Pitfall 4: No Error Handler Installed
**What goes wrong:** Unhandled errors in middleware cause `bot.start()` to throw and crash the process. With long polling, grammY's default error handler re-throws errors.
**Why it happens:** Not installing `bot.catch()` handler. Default behavior stops the bot on any middleware error.
**How to avoid:** Always install `bot.catch()` with logging. Log the error, don't crash the process. Let the polling loop continue.
**Warning signs:** Bot crashes on the first error (bad user input, API timeout, network glitch).

### Pitfall 5: Not Awaiting bot.start()
**What goes wrong:** `bot.start()` returns a Promise. If not awaited at the top level, errors during polling are unhandled promise rejections.
**Why it happens:** Forgetting to `await` or not using top-level await.
**How to avoid:** Use `await bot.start()` or `.catch()` on the returned promise. Bun supports top-level await in `.ts` files.
**Warning signs:** Unhandled promise rejection warnings in console.

### Pitfall 6: Claude API Errors Not Caught
**What goes wrong:** Anthropic API returns rate limit (429), server error (500), or network failure. Without handling, bot crashes or sends no response.
**Why it happens:** Not wrapping `messages.create()` in try/catch. Not handling specific error types.
**How to avoid:** Wrap Claude calls in try/catch. Send a user-friendly error message on failure. Log the real error. The Anthropic SDK has built-in retries for transient errors but rate limits still need handling.
**Warning signs:** Bot goes silent after Claude API errors. No response to user.

## Code Examples

Verified patterns from official sources:

### Complete Bot Setup
```typescript
// src/telegram/bot.ts
// Source: https://grammy.dev/guide/getting-started + https://github.com/grammyjs/auto-chat-action
import { Bot, Context, GrammyError, HttpError } from "grammy";
import { autoChatAction, AutoChatActionFlavor } from "@grammyjs/auto-chat-action";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { authGuard } from "./middleware/auth.ts";
import { handleMessage } from "./handlers/message.ts";

export type BotContext = Context & AutoChatActionFlavor;

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Middleware stack (order matters)
bot.use(authGuard);
bot.use(autoChatAction());

// Handlers
bot.command("start", (ctx) => ctx.reply("Hello! I'm Rachel, your personal AI assistant."));
bot.on("message:text", handleMessage);

// Error handler — log and continue, don't crash
bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;

  logger.error(`Error handling update ${ctx.update.update_id}`, {
    error: e instanceof GrammyError
      ? e.description
      : e instanceof HttpError
        ? `Network error: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e),
  });
});
```

### Updated Entry Point
```typescript
// src/index.ts
// Source: https://grammy.dev/guide/deployment-types (long polling section)
import { bot } from "./telegram/bot.ts";
import { logger } from "./lib/logger.ts";
import { env } from "./config/env.ts";

logger.info("Rachel8 starting...", { env: env.NODE_ENV });

// Graceful shutdown
process.once("SIGTERM", () => bot.stop());
process.once("SIGINT", () => bot.stop());

// Start long polling — keeps process alive, replaces setInterval keepalive
await bot.start({
  onStart: () => logger.info("Rachel8 is running. Listening for messages..."),
});
```

### Updated Env Schema
```typescript
// src/config/env.ts — additions for Phase 2
export const envSchema = z.object({
  // ... existing fields ...
  OWNER_TELEGRAM_USER_ID: z.coerce.number().int().positive({
    message: "Must be a positive integer. Send /start to @userinfobot on Telegram to find your user ID",
  }),
});
```

### Anthropic SDK Client
```typescript
// src/ai/claude.ts
// Source: https://platform.claude.com/docs/en/api/client-sdks
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly. You communicate via Telegram, so keep responses reasonably brief unless asked for detail.`;

export async function generateResponse(userMessage: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock?.text ?? "I'm sorry, I couldn't generate a response.";
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Telegraf framework | grammY | 2021+ | grammY has better TypeScript support, Bot API coverage, and plugin ecosystem |
| Raw `sendChatAction` intervals | `@grammyjs/auto-chat-action` plugin | 2023+ | Eliminates manual timer management for typing indicators |
| Webhook-first for all bots | Long polling recommended for most bots | Always | grammY docs explicitly recommend long polling unless you have specific webhook needs |
| OpenAI SDK for all AI | Anthropic SDK for Claude specifically | 2024+ | Direct SDK provides better types, streaming, and error handling than OpenAI-compatible wrappers |
| Agent SDK for all Claude interactions | Basic SDK for simple responses, Agent SDK for tool-using agents | 2025+ | Agent SDK renamed from Claude Code SDK. Use basic SDK when you don't need autonomous tool execution |

**Deprecated/outdated:**
- Telegraf: Still maintained but grammY is the modern TypeScript-first choice
- `node-telegram-bot-api`: Very old, lacks middleware system
- Using `dotenv` package with Bun: Unnecessary, Bun loads `.env` automatically

## Open Questions

1. **Which Claude model to use for Phase 2?**
   - What we know: `claude-sonnet-4-5-20250929` is the latest Sonnet model. `claude-opus-4-6` is the most capable.
   - What's unclear: Cost vs quality tradeoff for a personal assistant. Sonnet is cheaper and faster. Opus is smarter.
   - Recommendation: Start with Sonnet for Phase 2 (basic responses). Make the model configurable via env var so it can be changed without code changes. Upgrade to Opus in Phase 3 when agent intelligence matters more.

2. **Should auth middleware silently ignore or send rejection message?**
   - What we know: Both approaches work. Silent ignore doesn't reveal the bot exists. Rejection message is more user-friendly.
   - What's unclear: Whether unauthorized users will ever message the bot (it's a personal bot, not listed publicly).
   - Recommendation: Silent ignore (return early without calling `next()`). Log the attempt. This is more secure -- don't reveal the bot exists to random users. If the bot gets spam from groups, silent ignore prevents it from engaging.

3. **Should the setup wizard collect OWNER_TELEGRAM_USER_ID?**
   - What we know: The user needs to find their Telegram user ID (via @userinfobot). The setup wizard from Phase 1 already collects other config.
   - What's unclear: Whether to add to the wizard now or just document it as a manual `.env` addition.
   - Recommendation: Add to the setup wizard. Include instructions: "Send /start to @userinfobot on Telegram to get your user ID." This is consistent with Phase 1's approach of wizard-driven setup.

4. **Conversation history for Phase 2?**
   - What we know: Phase 2 requirement MSG-01 says "intelligent responses." Phase 3 requirement INTEL-01 says "conversation history within a thread."
   - What's unclear: Whether Phase 2 needs any conversation context or if single-turn (no memory) is acceptable.
   - Recommendation: Phase 2 should be single-turn (no conversation history). Each message is independent. This keeps scope small. Phase 3 adds memory and context. The code structure should make it easy to add message history to `messages.create()` later.

## Sources

### Primary (HIGH confidence)
- [grammY Deployment Types (Long Polling vs Webhooks)](https://grammy.dev/guide/deployment-types) - Polling vs webhook tradeoffs, `bot.start()` usage, timeout behavior
- [grammY Getting Started](https://grammy.dev/guide/getting-started) - Bot class, handler registration, basic setup
- [grammY Middleware Guide](https://grammy.dev/guide/middleware) - Middleware stack, `next()`, custom middleware patterns
- [grammY Error Handling](https://grammy.dev/guide/errors) - `bot.catch()`, BotError/GrammyError/HttpError types
- [grammY Context Reference](https://grammy.dev/ref/core/context) - `ctx.from`, `ctx.chat`, `ctx.reply`, chat actions
- [grammY Deployment Checklist](https://grammy.dev/advanced/deployment) - Production best practices
- [grammY auto-chat-action Plugin (GitHub)](https://github.com/grammyjs/auto-chat-action) - Typing indicator plugin API
- [Anthropic Client SDKs](https://platform.claude.com/docs/en/api/client-sdks) - TypeScript SDK installation, `messages.create()`, model names
- [Anthropic Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - Agent SDK vs Client SDK comparison, when to use each

### Secondary (MEDIUM confidence)
- [grammY webhookCallback Reference](https://grammy.dev/ref/core/webhookcallback) - Supported framework adapters including "bun"
- [grammy-middlewares Plugin](https://grammy.dev/plugins/middlewares) - `ignoreOld()`, `onlySuperAdmin()` middleware utilities
- [bot-base/telegram-bot-template](https://github.com/bot-base/telegram-bot-template) - Reference project structure with grammY + Bun
- [Telegram Bot API sendChatAction](https://core.telegram.org/bots/api#sendchataction) - Typing indicator lasts 5 seconds, must repeat

### Tertiary (LOW confidence)
- None. All findings verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - grammY, Anthropic SDK, and auto-chat-action are all verified from official docs
- Architecture: HIGH - Long polling pattern is well-documented, middleware patterns are standard grammY
- Pitfalls: HIGH - All pitfalls derived from official grammY docs or verified Telegram Bot API behavior

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable ecosystem, 30-day validity)
