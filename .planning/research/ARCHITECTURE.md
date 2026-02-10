# Architecture Research

**Domain:** Personal AI Assistant (Telegram bot with scheduling, file management, and proactive messaging)
**Researched:** 2026-02-10
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TELEGRAM INTERFACE                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  grammY Bot (Webhook Handler)                          │  │
│  │  - Receives updates from Telegram                      │  │
│  │  - Responds within 10s timeout                         │  │
│  │  - Delegates to Agent for processing                   │  │
│  └─────────────────────┬──────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    CORE AGENT LAYER                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │ Claude Agent SDK │  │ Conversation     │  │ Tool       │ │
│  │ (query/stream)   │  │ Context Manager  │  │ Registry   │ │
│  └────────┬─────────┘  └────────┬─────────┘  └─────┬──────┘ │
│           │                     │                   │        │
│           └─────────────────────┴───────────────────┘        │
├─────────────────────────────────────────────────────────────┤
│                      INTEGRATION LAYER                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Scheduler    │  │ File Manager │  │ Syncthing        │   │
│  │ (BunQueue)   │  │              │  │ Monitor          │   │
│  │              │  │              │  │                  │   │
│  │ • Cron jobs  │  │ • Upload     │  │ • Watch vault    │   │
│  │ • Delayed    │  │ • Download   │  │ • File events    │   │
│  │ • Reminders  │  │ • Organize   │  │ • Metadata sync  │   │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬────────┘   │
│         │                 │                    │             │
├─────────┴─────────────────┴────────────────────┴─────────────┤
│                    PERSISTENCE LAYER                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ SQLite DB       │  │ BunQueue DB     │  │ Obsidian    │  │
│  │ • Conversations │  │ (embedded)      │  │ Vault       │  │
│  │ • User context  │  │ • Job queue     │  │ (Syncthing) │  │
│  │ • Metadata      │  │ • Cron state    │  │ • Notes     │  │
│  │                 │  │                 │  │ • Files     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Webhook Handler** | Accept Telegram updates, validate, delegate to agent | grammY `webhookCallback` with Express/Hono |
| **Agent Core** | Process requests using Claude, manage tool execution | Claude Agent SDK `query()` with streaming |
| **Conversation Manager** | Load/save chat history, manage context window | SQLite queries with thread-aware retrieval |
| **Tool Registry** | Register and expose tools to agent | MCP server with custom tool definitions |
| **Scheduler** | Manage cron jobs, delayed jobs, reminders | BunQueue embedded mode with SQLite |
| **File Manager** | Handle Telegram file uploads/downloads | Telegram Bot API + local storage |
| **Syncthing Monitor** | Watch vault for changes, notify agent | FS watcher or Syncthing REST API polling |
| **Vault Organizer** | Structure notes, manage attachments | File operations based on agent decisions |

## Recommended Project Structure

```
src/
├── main.ts                    # Entry point, process initialization
├── telegram/                  # Telegram interface layer
│   ├── bot.ts                # grammY bot setup
│   ├── handlers/             # Message/command handlers
│   │   ├── text.ts          # Text message handler
│   │   ├── file.ts          # File upload handler
│   │   └── callback.ts      # Callback query handler
│   └── middleware/           # grammY middleware
│       ├── auth.ts          # Single-user verification
│       └── logging.ts       # Request logging
├── agent/                    # Claude Agent SDK integration
│   ├── client.ts            # Agent initialization
│   ├── tools/               # Custom MCP tools
│   │   ├── telegram.ts      # Send proactive messages
│   │   ├── vault.ts         # Vault operations
│   │   ├── reminder.ts      # Schedule reminders
│   │   └── index.ts         # Tool registry
│   ├── context.ts           # Conversation context management
│   └── prompts.ts           # System prompts, instructions
├── scheduler/               # BunQueue integration
│   ├── queue.ts            # Queue initialization
│   ├── workers/            # Job handlers
│   │   ├── reminder.ts     # Reminder execution
│   │   ├── cron.ts         # Scheduled tasks
│   │   └── proactive.ts    # Proactive messaging
│   └── jobs.ts             # Job definitions
├── vault/                  # File and vault management
│   ├── watcher.ts         # Syncthing/FS monitoring
│   ├── organizer.ts       # File organization logic
│   ├── metadata.ts        # File metadata management
│   └── sync.ts            # Syncthing integration
├── db/                    # Database layer
│   ├── client.ts         # SQLite connection
│   ├── schema.ts         # Table definitions
│   ├── queries/          # Database operations
│   │   ├── conversations.ts
│   │   ├── files.ts
│   │   └── users.ts
│   └── migrations/       # Schema migrations
└── types/                # TypeScript types
    ├── telegram.ts
    ├── agent.ts
    └── vault.ts
```

### Structure Rationale

- **telegram/**: Isolated interface layer. grammY-specific code stays here. Easy to swap for other interfaces later.
- **agent/**: All Claude Agent SDK interactions in one place. Tools are modular and testable.
- **scheduler/**: BunQueue embedded mode keeps scheduling self-contained. Workers are separate from definitions for clarity.
- **vault/**: File operations and Syncthing integration. Separates watching from organizing.
- **db/**: Clean data layer with migrations. Queries are organized by domain.

## Architectural Patterns

### Pattern 1: Async Delegation from Webhook

**What:** Webhook handler immediately acknowledges Telegram, queues agent processing asynchronously

**When to use:** ALWAYS for Telegram webhooks (10s timeout requirement)

**Trade-offs:**
- ✅ No duplicate messages from Telegram retries
- ✅ Handles long-running agent queries
- ❌ User sees "typing..." but response comes later
- ❌ Requires background job system

**Example:**
```typescript
// telegram/handlers/text.ts
import { Context } from 'grammy';
import { enqueueAgentQuery } from '../../scheduler/jobs';

export async function handleTextMessage(ctx: Context) {
  const chatId = ctx.chat!.id;
  const text = ctx.message!.text!;

  // Immediately acknowledge to Telegram
  await ctx.react('👀'); // Show "seen"

  // Queue background agent processing
  await enqueueAgentQuery({
    chatId,
    messageId: ctx.message!.message_id,
    text,
  });

  // Return quickly (under 10s)
  return;
}
```

### Pattern 2: Embedded BunQueue for Single-Process

**What:** BunQueue runs in same process as bot, shares SQLite database

**When to use:** Single-server deployments (Hetzner VPS use case)

**Trade-offs:**
- ✅ Zero network overhead
- ✅ Shared database transactions
- ✅ Simple deployment (one process)
- ❌ Can't scale horizontally (not needed for single-user)
- ❌ Process restart affects all jobs (use WAL mode for resilience)

**Example:**
```typescript
// scheduler/queue.ts
import { Queue, Worker } from 'bunqueue';

// Embedded mode: runs in-process
export const queue = new Queue('rachel8', {
  embedded: true,
  db: './data/rachel8.db' // Same DB as main app
});

export const worker = new Worker('rachel8', processJob, {
  embedded: true,
  db: './data/rachel8.db'
});

// scheduler/jobs.ts
export async function scheduleReminder(
  chatId: number,
  text: string,
  triggerAt: Date
) {
  return queue.add('reminder', { chatId, text }, {
    delay: triggerAt.getTime() - Date.now()
  });
}
```

### Pattern 3: Streaming Agent with Tool Execution

**What:** Use Claude Agent SDK's async generator to stream responses and handle tool calls

**When to use:** All agent interactions (chat, scheduled tasks, file processing)

**Trade-offs:**
- ✅ Real-time feedback to user
- ✅ Handle tool calls automatically
- ✅ Lower latency (stream as generated)
- ❌ More complex than single-shot API call
- ❌ Must handle partial messages

**Example:**
```typescript
// agent/client.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { tools } from './tools';

export async function processQuery(
  prompt: string,
  conversationHistory: Message[]
) {
  const result = query({
    prompt,
    options: {
      tools: ['Task', 'Bash', ...Object.keys(tools)],
      mcpServers: {
        rachel8: {
          type: 'sdk',
          name: 'rachel8-tools',
          instance: createToolServer(tools)
        }
      },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: RACHEL_SYSTEM_PROMPT
      }
    }
  });

  // Stream messages
  for await (const message of result) {
    if (message.type === 'assistant') {
      // Stream text chunks to Telegram
      yield message.message.content;
    }
  }
}
```

### Pattern 4: Conversation Context Window Management

**What:** Load recent messages + semantic search for older context, store in SQLite

**When to use:** Every agent query to provide conversation continuity

**Trade-offs:**
- ✅ Unlimited conversation history
- ✅ Semantic retrieval of relevant context
- ✅ Cost-effective (only recent messages in context)
- ❌ Requires embeddings (can use simple keyword search initially)
- ❌ Context stitching complexity

**Example:**
```typescript
// agent/context.ts
export async function getConversationContext(
  chatId: number,
  currentMessage: string
): Promise<Message[]> {
  // Always include last 20 messages
  const recent = await db.query(
    `SELECT * FROM messages
     WHERE chat_id = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    [chatId]
  );

  // Optionally: semantic search for older relevant messages
  // const semantic = await semanticSearch(currentMessage, chatId, limit: 5);

  return recent.reverse(); // Chronological order
}
```

### Pattern 5: Syncthing File Event Monitoring

**What:** Watch Obsidian vault for changes, notify agent of new/modified files

**When to use:** Proactive file organization, auto-tagging, note suggestions

**Trade-offs:**
- ✅ Agent can react to external changes
- ✅ Enables automation workflows
- ❌ Event deduplication needed (Syncthing 10s delay)
- ❌ Must filter out agent's own changes

**Example:**
```typescript
// vault/watcher.ts
import { watch } from 'fs';
import { debounce } from 'bun';

export function watchVault(vaultPath: string) {
  const watcher = watch(vaultPath, { recursive: true });

  const processChange = debounce(async (event: string, filename: string) => {
    // Ignore agent's own writes
    if (isAgentGenerated(filename)) return;

    // Queue agent processing
    await enqueueAgentQuery({
      type: 'file_change',
      event,
      filename,
      fullPath: path.join(vaultPath, filename)
    });
  }, 10_000); // Match Syncthing's 10s delay

  for await (const event of watcher) {
    processChange(event.eventType, event.filename);
  }
}
```

## Data Flow

### Request Flow (User-Initiated)

```
User sends message
    ↓
Telegram → Webhook (grammY)
    ↓
Auth middleware (verify single user)
    ↓
Handler stores message in SQLite
    ↓
Enqueue agent job (BunQueue)
    ↓
Return 200 OK to Telegram (<10s)
    ↓
Worker picks up job
    ↓
Load conversation context (SQLite)
    ↓
Agent SDK processes with tools
    ↓
Stream response to Telegram
    ↓
Store assistant message in SQLite
```

### Scheduled Flow (Agent-Initiated)

```
Cron trigger (BunQueue)
    ↓
Worker executes job
    ↓
Load user context (SQLite)
    ↓
Agent SDK generates message
    ↓
Send via Telegram Bot API
    ↓
Store proactive message (SQLite)
```

### File Flow (Syncthing-Initiated)

```
File changes in Obsidian vault
    ↓
Syncthing syncs to VPS
    ↓
FS watcher detects change (10s debounce)
    ↓
Enqueue file processing job
    ↓
Worker reads file metadata
    ↓
Agent SDK suggests organization
    ↓
Apply changes or ask user
    ↓
Update file metadata (SQLite)
```

### Key Data Flows

1. **Message persistence**: All Telegram messages (user + assistant) → SQLite with thread tracking
2. **Job persistence**: BunQueue jobs → SQLite (embedded mode, same DB)
3. **File metadata**: Vault file info → SQLite for quick lookup
4. **Syncthing state**: Watch state and last-seen timestamps → SQLite

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user (current) | Single process, embedded BunQueue, local SQLite with WAL mode |
| Multi-user (<100) | Still single process, add user isolation in DB, rate limiting per user |
| High volume (100+ users) | Consider: (1) Separate BunQueue server mode, (2) LibSQL replica for reads, (3) Multiple bot processes behind load balancer |

### Scaling Priorities

1. **First bottleneck: SQLite write contention**
   - Fix: Enable WAL mode (already handles ~100k ops/sec)
   - If still bottlenecked: Move to LibSQL with separate reader instances

2. **Second bottleneck: Agent SDK rate limits**
   - Fix: Queue management with priority (paying users first)
   - Add graceful degradation (simpler responses when rate limited)

## Anti-Patterns

### Anti-Pattern 1: Processing Long Tasks in Webhook Handler

**What people do:** Call Agent SDK directly in webhook handler, wait for response

**Why it's wrong:**
- Telegram 10s timeout causes duplicate message delivery
- Race conditions break session plugins
- User sees errors even though processing succeeds

**Do this instead:**
```typescript
// ❌ BAD
app.use(webhookCallback(bot, 'express'));
bot.on('message:text', async (ctx) => {
  const response = await agent.query(ctx.message.text); // TOO SLOW
  await ctx.reply(response);
});

// ✅ GOOD
bot.on('message:text', async (ctx) => {
  await ctx.react('👀');
  await queue.add('agent-query', {
    chatId: ctx.chat.id,
    text: ctx.message.text
  });
  // Handler returns quickly
});
```

### Anti-Pattern 2: Separate Database for BunQueue

**What people do:** Use different SQLite files for BunQueue and app data

**Why it's wrong:**
- Can't use transactions across databases
- Duplicate connection pooling
- Harder to backup/restore
- More disk I/O

**Do this instead:**
```typescript
// ✅ GOOD: Single database
const queue = new Queue('rachel8', {
  embedded: true,
  db: './data/rachel8.db' // Same as app DB
});
```

### Anti-Pattern 3: Ignoring Syncthing's Debounce

**What people do:** Process every FS event immediately

**Why it's wrong:**
- Syncthing batches changes with 10s delay
- Single file edit triggers multiple events
- Agent processes same file 10+ times
- Wasted API calls and confused state

**Do this instead:**
```typescript
// ✅ GOOD: Debounce to match Syncthing
const processChange = debounce(async (filename) => {
  await queue.add('file-process', { filename });
}, 10_000); // Match Syncthing's fsWatcherDelayS
```

### Anti-Pattern 4: Unbounded Conversation Context

**What people do:** Load entire conversation history into every agent query

**Why it's wrong:**
- Hits context window limits quickly
- Slow retrieval from DB
- Expensive API costs
- Most old messages irrelevant

**Do this instead:**
```typescript
// ✅ GOOD: Recent + semantic search
async function getContext(chatId: number, query: string) {
  const recent = await getRecentMessages(chatId, limit: 20);
  // Optional: const relevant = await semanticSearch(query, chatId, limit: 5);
  return [...recent]; // Bounded context
}
```

### Anti-Pattern 5: Running BunQueue in Server Mode for Single Process

**What people do:** Run `bunqueue start` as separate process and connect via TCP

**Why it's wrong:**
- Unnecessary network overhead
- Extra process to manage
- More complex deployment
- No benefit for single-server setup

**Do this instead:**
```typescript
// ✅ GOOD: Embedded mode
const queue = new Queue('rachel8', { embedded: true });
const worker = new Worker('rachel8', handler, { embedded: true });
```

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Telegram Bot API | Webhook (POST to `/webhook`) | Must use HTTPS, ports 443/80/88/8443 |
| Anthropic API | Claude Agent SDK | Handles retries, streaming, tool execution |
| Syncthing | REST API polling or FS watch | Use 10s debounce, monitor folder stats |
| Obsidian vault | Direct file I/O | Agent has Read/Write/Edit permissions |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Telegram ↔ Agent | Job queue (BunQueue) | Async, prevents timeout issues |
| Agent ↔ Scheduler | Tool calls (MCP) | Agent schedules jobs via tool |
| Agent ↔ Vault | Tool calls (MCP) | Agent reads/writes files via tool |
| Scheduler ↔ Telegram | Direct API call | Send proactive messages |
| Vault ↔ Scheduler | Job queue | File events trigger processing |

## Build Order Recommendations

Based on component dependencies and risk reduction:

### Phase 1: Foundation (Week 1)
**Goal:** Basic bot that can chat
- SQLite schema + migrations
- grammY webhook handler (dummy responses)
- Deploy to Hetzner, configure HTTPS
- Single-user auth middleware

**Why first:** Proves deployment, validates webhook setup (hard to debug later)

### Phase 2: Agent Integration (Week 1-2)
**Goal:** Intelligent chat responses
- Claude Agent SDK setup
- Conversation context management
- Basic conversation storage
- Stream responses to Telegram

**Why second:** Core value proposition, tests agent SDK in production

### Phase 3: Scheduling (Week 2)
**Goal:** Reminders and delayed tasks
- BunQueue embedded mode setup
- Reminder tool for agent
- Cron job support
- Job persistence in SQLite

**Why third:** Builds on agent tools, validates async patterns

### Phase 4: File Management (Week 3)
**Goal:** Handle file uploads/downloads
- Telegram file upload handler
- Store files in vault
- Basic file organization tool
- File metadata in SQLite

**Why fourth:** Simpler than Syncthing, establishes vault patterns

### Phase 5: Syncthing Integration (Week 3-4)
**Goal:** Watch vault, organize notes
- FS watcher with debouncing
- File change detection
- Agent-driven organization
- Metadata sync

**Why last:** Most complex, depends on file tools and scheduling

## Sources

**grammY and Telegram Webhooks:**
- [grammY GitHub Repository](https://github.com/grammyjs/grammY)
- [Building a Telegram bot with grammY - LogRocket Blog](https://blog.logrocket.com/building-telegram-bot-grammy/)
- [Long Polling vs. Webhooks | grammY](https://grammy.dev/guide/deployment-types)
- [Marvin's Marvellous Guide to All Things Webhook](https://core.telegram.org/bots/webhooks)
- [The Simplest Way to Deploy a Telegram Bot in 2026 | Kuberns Blog](https://kuberns.com/blogs/post/deploy-telegram-bot/)

**Claude Agent SDK:**
- [Agent SDK reference - TypeScript - Official Docs](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [The Complete Guide to Building Agents with the Claude Agent SDK](https://nader.substack.com/p/the-complete-guide-to-building-agents)
- [Cloudflare Anthropic Patterns](https://github.com/cloudflare/agents/tree/main/guides/anthropic-patterns)

**BunQueue:**
- [BunQueue Official Site](https://bunqueue.dev/)
- [BunQueue GitHub - High-performance job queue for Bun](https://github.com/egeominotti/bunqueue)
- [Show HN: Bunqueue – Job queue for Bun using SQLite | Hacker News](https://news.ycombinator.com/item?id=46851518)
- [Queues in Node.JS and Bun](https://www.nathanbeddoe.com/blog/queues-in-nodejs-and-bun)

**Personal Assistant Architecture:**
- [Clawdbot AI: Revolutionary Open-Source Personal Assistant](https://medium.com/@gemQueenx/clawdbot-ai-the-revolutionary-open-source-personal-assistant-transforming-productivity-in-2026-6ec5fdb3084f)
- [What Is Moltbot? – Local-First Personal AI Assistant Architecture](https://www.moltai.net/what-is-moltbot)
- [Introducing Moltworker: self-hosted personal AI agent](https://blog.cloudflare.com/moltworker-self-hosted-ai-agent/)

**Syncthing:**
- [Understanding Synchronization — Syncthing documentation](https://docs.syncthing.net/users/syncing.html)
- [Synchronization Model and Folders | syncthing/syncthing](https://deepwiki.com/syncthing/syncthing/2.2-synchronization-model-and-folders)
- [Syncthing Integration - Obsidian plugin](https://www.obsidianstats.com/plugins/syncthing-integration)
- [Using Syncthing for syncing markdown files (Obsidian) - Syncthing Forum](https://forum.syncthing.net/t/using-syncthing-for-syncing-markdown-files-obsidian/20808)

**Conversation Memory and SQLite:**
- [Memory: How Agents Learn](https://www.ashpreetbedi.com/articles/memory)
- [Persistent Memory Stores in LangChain](https://apxml.com/courses/langchain-production-llm/chapter-3-advanced-memory-management/persistent-memory-stores)
- [Unified Chat History and Logging System](https://medium.com/@mbonsign/unified-chat-history-and-logging-system-a-comprehensive-approach-to-ai-conversation-management-dc3b5d75499f)
- [Unlocking AI Memory: SQLite MCP Server](https://skywork.ai/skypage/en/unlocking-ai-memory-sqlite-mcp-server/1978640090500734976)

**TypeScript Architecture:**
- [Ultimate TypeScript Project Structure for 2026 Full-Stack Apps](https://medium.com/@mernstackdevbykevin/an-ultimate-typescript-project-structure-2026-edition-4a2d02faf2e0)
- [TypeScript Node.js Microservices: Scalable Apps with Bun Runtime 2026](https://www.johal.in/typescript-node-js-microservices-scalable-apps-with-bun-runtime-2026/)

---
*Architecture research for: Rachel8 Personal AI Assistant*
*Researched: 2026-02-10*
