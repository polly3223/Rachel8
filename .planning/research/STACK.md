# Technology Stack

**Project:** Rachel8 - Personal AI Assistant with Telegram Interface
**Researched:** 2026-02-10
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Bun** | v1.3.9 (latest stable) | JavaScript runtime and package manager | All-in-one runtime (no separate package manager needed), native TypeScript support, built-in test runner, ~3x faster than Node.js. Native SQLite support via `bun:sqlite`. Version 1.3.9 released Feb 8, 2026. |
| **Anthropic Agent SDK** | v0.2.38 (TypeScript) | AI agent framework for Claude | Official SDK for building agents with Claude Opus 4.6. Provides structured outputs, MCP server support, file operations, sandboxing, and multi-turn conversations. Updated to parity with Claude Code v2.1.38 (Feb 10, 2025). |
| **grammY** | Latest (Telegram Bot API 9.4) | Telegram bot framework | Modern TypeScript-first framework supporting Bot API 9.4 (Feb 9, 2026). Built-in plugins for sessions, conversations, and threading. Works natively with Bun, Deno, and Node.js. Supports streaming responses and threaded conversations. |
| **BunQueue** | v2.4.0 | Job scheduler and queue | High-performance job queue built specifically for Bun. 32x faster than BullMQ. Zero Redis dependencies (uses SQLite). Includes cron jobs, retries, dead letter queues, stall detection, and S3 backups. Production-ready with embedded or server mode. |
| **LibSQL Client** | v0.17.0 (@libsql/client) | SQLite database client | TypeScript client for libSQL/Turso. Supports local SQLite, embedded replicas, remote databases, encryption at rest, and offline sync. Fork of SQLite with modern features. Compatible with standard SQLite file format. |
| **Drizzle ORM** | Latest | TypeScript ORM | Lightweight (~7.4kb), type-safe ORM with zero dependencies. Native support for `bun:sqlite` with both sync and async APIs. Provides migrations, schema validation, and SQL-like query builder. Best-in-class TypeScript experience. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod** | Latest | Runtime validation and schema definition | Required for Anthropic Agent SDK tool definitions. Provides type-safe input validation for MCP tools, structured outputs, and environment variables. First-class support in Agent SDK via `tool()` helper. |
| **@grammyjs/conversations** | Latest | Multi-step conversation flows | For complex user interactions requiring multiple back-and-forth messages (e.g., guided setup, multi-step forms). Built-in persistence for conversation state. |
| **@grammyjs/session** | Built-in to grammY | Session management | Store user-specific data between messages. Essential for tracking conversation context, user preferences, and temporary state. Built-in to grammY core. |
| **pino** | Latest | Structured logging | High-performance JSON logger (5x faster than Winston). Minimal CPU overhead, async I/O, built-in data redaction. Industry standard for Node.js/Bun microservices. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Bun built-in test runner** | Testing | Jest-compatible API, 10-50x faster than Jest, built-in coverage, no config needed. Supports TypeScript/JSX natively. |
| **TypeScript** | Type safety | Bun executes .ts files natively without transpilation. Use `bun --watch` for dev mode with hot reload. |
| **systemd** | Process management (VPS) | Standard Linux service manager. Run Bun as daemon with auto-restart. See installation section below. |

## Installation

### Core Setup

```bash
# Install Bun runtime (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Initialize project
bun init

# Core dependencies
bun add @anthropic-ai/claude-agent-sdk grammy bunqueue @libsql/client drizzle-orm zod pino

# Dev dependencies
bun add -D @types/bun
```

### Optional Plugins

```bash
# grammY plugins (add as needed)
bun add @grammyjs/conversations  # Multi-step conversations
```

### Database Setup

```bash
# Initialize Drizzle
bun add -D drizzle-kit
bunx drizzle-kit init --dialect=sqlite
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Bun** | Node.js + tsx | If you need maximum npm package compatibility or mature debugging tools. Bun v1.3+ is production-ready for most use cases. |
| **BunQueue** | BullMQ (Redis-based) | If you already have Redis infrastructure or need multi-language worker support. BunQueue is simpler for Bun-only stacks. |
| **grammY** | Telegraf | If you need battle-tested stability with larger community. grammY is more modern with better TypeScript support. |
| **Drizzle ORM** | Prisma | If you prefer schema-first design and need advanced GUI tools. Drizzle is lighter and faster with native Bun support. |
| **LibSQL** | Standard SQLite (via `bun:sqlite`) | For simpler local-only needs without embedded replicas or encryption. LibSQL adds modern features while maintaining compatibility. |
| **pino** | winston | If you need extremely flexible transport system with many destinations. Pino is faster and more suitable for high-throughput applications. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **OpenAI SDK with function calling** | Inferior to Anthropic's Agent SDK for long-running tasks. Lacks built-in file operations, sandboxing, and persistent state management. | Anthropic Agent SDK with MCP tools |
| **Raw Telegram Bot API** | Low-level, verbose, lacks middleware system. Error-prone for complex bots. | grammY or Telegraf |
| **bull / bull-board (older versions)** | Designed for Node.js/Redis. Poor Bun compatibility. Abandoned in favor of BullMQ. | BunQueue (Bun) or BullMQ (Node.js) |
| **TypeORM** | Heavy, slow, compatibility issues with Bun. Not optimized for SQLite. | Drizzle ORM |
| **dotenv package** | Unnecessary - Bun loads .env files automatically. Adds extra dependency. | Bun's built-in `Bun.env` |
| **ts-node** | Slow TypeScript execution. Not needed with Bun. | Bun native TypeScript support |
| **jest** | Slow, heavy, requires configuration. | Bun's built-in test runner |

## Stack Patterns by Variant

**For single-user personal assistant (your use case):**
- Use embedded SQLite via `bun:sqlite` for local data
- BunQueue in embedded mode (no separate server)
- LibSQL with local file path (no Turso remote)
- grammY with sessions stored in SQLite
- Syncthing for Obsidian vault sync (already implemented)

**For multi-user deployment:**
- Use LibSQL with Turso remote + embedded replicas
- BunQueue in server mode (TCP on port 6789)
- Add user authentication middleware for grammY
- Consider horizontal scaling with session persistence

**For AI agent with file access:**
- Enable Anthropic Agent SDK sandbox mode
- Use `additionalDirectories` option to grant access to synced folders
- Set `permissionMode: 'acceptEdits'` for auto-approval of file edits in trusted directories
- Use `enableFileCheckpointing` for rollback capability

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @anthropic-ai/claude-agent-sdk@0.2.38 | Bun v1.3.x | Full compatibility. Agent SDK officially supports Bun. |
| grammy@latest | Bun v1.3.x | Native support. grammY packages published by @grammyjs run natively on Bun, Deno, and Node.js. |
| bunqueue@2.4.0 | Bun v1.3.x only | BunQueue requires Bun runtime. Node.js is NOT supported. |
| drizzle-orm@latest | bun:sqlite, @libsql/client | Use `drizzle-orm/bun-sqlite` or `drizzle-orm/libsql` adapters. |
| @libsql/client@0.17.0 | Bun v1.3.x, Node.js, Deno | Universal client. Works across all runtimes. |
| zod@latest | All versions | Zero-dependency library. Universal compatibility. |

## Configuration Best Practices

### Environment Variables (Type-Safe)

```typescript
// env.ts - Centralized configuration with validation
import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_PATH: z.string().default('./data/rachel8.db'),
  OBSIDIAN_VAULT_PATH: z.string(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = envSchema.parse(Bun.env);
```

**Why this pattern:**
- Bun loads `.env` automatically (no dotenv package needed)
- Zod validates config at startup (fail-fast on misconfiguration)
- TypeScript inference gives autocomplete for `env.*`
- Centralized configuration makes testing easier

### Structured Logging

```typescript
// logger.ts
import pino from 'pino';

export const logger = pino({
  level: Bun.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  },
  // Redact sensitive fields
  redact: ['req.headers.authorization', 'telegramToken', 'apiKey']
});
```

### Database Schema with Drizzle

```typescript
// schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey(),
  telegramChatId: integer('telegram_chat_id').notNull(),
  sessionId: text('session_id').notNull(),
  context: text('context', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

### MCP Tools for Agent SDK

```typescript
// tools.ts
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const noteTool = tool(
  'save_note',
  'Saves a note to the Obsidian vault',
  {
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
  },
  async (args) => {
    // Implementation
    return { content: [{ type: 'text', text: 'Note saved' }] };
  }
);

export const mcpServer = createSdkMcpServer({
  name: 'rachel8-tools',
  version: '1.0.0',
  tools: [noteTool],
});
```

## Deployment (Hetzner VPS with systemd)

### systemd Service Configuration

```ini
# /etc/systemd/system/rachel8.service
[Unit]
Description=Rachel8 Personal AI Assistant
After=network.target

[Service]
Type=simple
User=lory
WorkingDirectory=/home/lory/rachel8
ExecStart=/home/lory/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=10
Environment="NODE_ENV=production"

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/lory/rachel8/data /home/lory/Obsidian

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable rachel8
sudo systemctl start rachel8
sudo systemctl status rachel8

# View logs
sudo journalctl -u rachel8 -f
```

## Key Integration Points

### Telegram → Agent SDK Flow

1. grammY receives message from Telegram
2. Retrieve conversation context from SQLite (via Drizzle)
3. Pass message to Agent SDK `query()` with session ID
4. Stream Agent SDK responses back to Telegram
5. Update conversation history in database
6. Queue scheduled tasks via BunQueue

### Scheduled Tasks Flow

1. BunQueue cron job triggers (e.g., daily reminder)
2. Job handler retrieves task details from SQLite
3. Initialize Agent SDK query with task prompt
4. Agent executes (may read Obsidian vault, search web, etc.)
5. Send result to user via grammY bot
6. Update task status in database

### File Management Flow

1. User requests file operation via Telegram
2. Agent SDK accesses synced Obsidian vault (via `additionalDirectories`)
3. Uses Read/Write/Edit tools for file operations
4. Syncthing propagates changes to other devices
5. Confirmation sent to Telegram

## Sources

### Official Documentation
- [Anthropic Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — Full API documentation (HIGH confidence)
- [grammY Official Website](https://grammy.dev/) — Framework documentation (HIGH confidence)
- [Bun Documentation](https://bun.com/docs) — Runtime and tooling (HIGH confidence)
- [BunQueue Official Site](https://bunqueue.dev/) — Queue system docs (HIGH confidence)
- [Drizzle ORM - Bun SQLite](https://orm.drizzle.team/docs/connect-bun-sqlite) — ORM integration (HIGH confidence)
- [LibSQL Documentation](https://docs.turso.tech/libsql) — Database client (HIGH confidence)

### Release Information
- [Anthropic Agent SDK Releases](https://github.com/anthropics/claude-agent-sdk-typescript/releases) — Latest v0.2.38 (Feb 10, 2025) (HIGH confidence)
- [Bun Releases](https://github.com/oven-sh/bun/releases) — Latest v1.3.9 (Feb 8, 2026) (HIGH confidence)
- [LibSQL Client TypeScript](https://github.com/tursodatabase/libsql-client-ts) — v0.17.0 (Feb 7, 2026) (HIGH confidence)

### Best Practices
- [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) — Anthropic official guide (HIGH confidence)
- [Bun Production Deployment](https://bun.com/docs/guides/ecosystem/systemd) — systemd configuration (HIGH confidence)
- [grammY Sessions and Conversations](https://grammy.dev/plugins/session) — State management patterns (HIGH confidence)
- [Pino Logger Guide](https://signoz.io/guides/pino-logger/) — Structured logging (MEDIUM confidence)

### Comparison and Analysis
- [Pino vs Winston](https://betterstack.com/community/comparisons/pino-vs-winston/) — Performance comparison (MEDIUM confidence)
- [Drizzle ORM with Bun](https://bun.com/docs/guides/ecosystem/drizzle) — Integration guide (HIGH confidence)
- [BunQueue GitHub](https://github.com/egeominotti/bunqueue) — Source code and examples (HIGH confidence)

---
*Stack research for: Personal AI Assistant with Telegram Interface*
*Researched: 2026-02-10*
*Confidence: HIGH - All core technologies verified with official documentation and recent releases*
