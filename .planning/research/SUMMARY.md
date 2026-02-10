# Project Research Summary

**Project:** Rachel8 - Personal AI Assistant with Telegram Interface
**Domain:** Personal AI Assistant (Single-user, VPS-hosted)
**Researched:** 2026-02-10
**Confidence:** HIGH

## Executive Summary

Rachel8 is a personal AI assistant accessed through Telegram, designed as a single-user system with deep integration into the user's workflows through Obsidian vault access, scheduled task execution, and shell command capabilities. The project is motivated by reliability failures in OpenClaw, specifically around scheduled task execution. Expert practitioners build this type of system using modern TypeScript frameworks with embedded databases, job queues for async task handling, and careful security boundaries despite LLM tool access.

The recommended approach uses Bun as the all-in-one runtime (eliminating separate package managers), Anthropic Agent SDK for Claude Opus 4.6 integration with MCP tools, grammY for Telegram bot handling, and BunQueue for reliable job scheduling. The architecture follows an async delegation pattern where Telegram webhooks immediately acknowledge and queue agent processing, preventing timeout issues. Critical emphasis on embedded BunQueue with heartbeat mechanisms to prevent the task amnesia that plagued OpenClaw.

Key risks center on scheduled task reliability (use BunQueue with heartbeat and self-healing), security with shell access (command allowlisting and sandboxing, never sudo for agent process), and context management for long-running conversations (sliding window with compression to prevent token cost explosion). The single-user constraint significantly simplifies authentication, data isolation, and scaling concerns, allowing focus on reliability and deep personalization.

## Key Findings

### Recommended Stack

The modern approach for personal AI assistants centers on runtime consolidation and embedded data persistence to minimize moving parts. Bun v1.3.9 provides native TypeScript execution, built-in SQLite support, and integrated testing at 3x Node.js speed. This eliminates the need for ts-node, separate test frameworks, or dotenv packages while maintaining production readiness.

**Core technologies:**
- **Bun v1.3.9**: JavaScript runtime and package manager — native TypeScript, built-in SQLite, 3x faster than Node.js
- **Anthropic Agent SDK v0.2.38**: AI agent framework — official Claude Opus 4.6 SDK with MCP tools, structured outputs, sandboxing
- **grammY (latest)**: Telegram bot framework — TypeScript-first, Bot API 9.4 support, built-in sessions and conversations
- **BunQueue v2.4.0**: Job scheduler and queue — 32x faster than BullMQ, zero Redis dependencies (uses SQLite), embedded mode for single-process deployment
- **LibSQL Client v0.17.0**: Database client — Turso-compatible SQLite with modern features, optional remote sync
- **Drizzle ORM (latest)**: Type-safe ORM — lightweight (7.4kb), native Bun support, SQL-like queries

**Critical version compatibility:** All packages verified to work with Bun v1.3.x. BunQueue requires Bun runtime (Node.js not supported). Agent SDK officially supports Bun with full compatibility.

**What NOT to use:** Avoid OpenAI SDK (inferior for long-running tasks), raw Telegram Bot API (error-prone), TypeORM (poor Bun compatibility), PM2 (extra complexity vs systemd), jest (use Bun's built-in test runner).

### Expected Features

Personal AI assistants in 2026 are expected to handle multi-turn conversations, reliable scheduling, and file management as baseline capabilities. Differentiation comes from deep integrations and workflow embedding rather than feature breadth.

**Must have (table stakes):**
- Text chat interface via Telegram — Core interaction method
- Basic reminders/scheduling — Reliability critical (OpenClaw's failure point)
- Conversation history (thread-based) — Essential for coherent interactions
- Natural language understanding — Claude Opus 4.6 handles natively
- File upload/download — Telegram supports natively, storage needed
- Web search capability — Tavily or Perplexity API integration
- Reliable 24/7 uptime — VPS with systemd process management
- Privacy/security — Single-user simplifies, but shell access requires controls

**Should have (competitive):**
- Obsidian vault integration — Deep knowledge management, bidirectional sync
- Shell command execution (whitelisted) — Real automation, not just suggestions
- Proactive messaging — Time and pattern-based triggers
- Long-term memory across sessions — Thread history + vault notes
- Recurring task reliability — Unlike failed competitors, this actually works
- Single-user optimization — No multi-user complexity, deeply personalized
- Context-aware file management — AI-powered categorization

**Defer (v2+):**
- Voice message input/output — Adds transcription complexity, validate core value first
- Multi-modal file analysis — Image understanding, PDF parsing
- Predictive proactive messaging — ML-based pattern detection
- Cross-vault knowledge graph — Entity extraction and relationships

**Anti-features to avoid:** Real-time notifications for everything (causes fatigue), multi-user support (massive complexity increase), unlimited conversation history (context pollution), AI full autonomy (trust erosion).

### Architecture Approach

The standard pattern for Telegram-based AI assistants uses a layered architecture with clear separation between interface (grammY webhook handler), agent core (Claude SDK with MCP tools), integration layer (BunQueue scheduler, file manager, Syncthing monitor), and persistence (SQLite, Obsidian vault). Critical pattern: async delegation from webhook to avoid 10s timeout — webhook immediately acknowledges Telegram and queues agent processing in BunQueue.

**Major components:**
1. **Telegram Interface (grammY)** — Webhook handler, immediately acknowledges (<10s), delegates to queue
2. **Agent Core (Claude SDK)** — Processes queries with streaming, manages tool execution, handles conversation context
3. **Scheduler (BunQueue embedded)** — Manages cron jobs, delayed tasks, reminders with heartbeat for reliability
4. **File Manager & Syncthing Monitor** — Handles uploads/downloads, watches vault for changes with 10s debounce
5. **Persistence (SQLite + Obsidian)** — Single database for app data and queue (WAL mode), vault via Syncthing

**Recommended structure:** Organize by layer (telegram/, agent/, scheduler/, vault/, db/) rather than feature. Keep grammY-specific code isolated in telegram/ for easy interface swapping. Agent tools in agent/tools/ are modular and testable. BunQueue workers separate from job definitions for clarity.

**Key patterns:**
- **Async delegation:** Webhook → immediate ack → queue → background worker
- **Embedded BunQueue:** Single-process deployment, shares SQLite database
- **Streaming agent:** Use Agent SDK async generator for real-time feedback
- **Context window management:** Recent messages + semantic search for older context
- **Syncthing event debouncing:** 10s debounce to match Syncthing's fsWatcherDelayS

**Integration flow:** User message → Telegram → grammY webhook → store in SQLite → enqueue agent job → return 200 OK → worker picks up → load context → Agent SDK processes → stream to Telegram → store response.

### Critical Pitfalls

Research identified eight critical pitfalls specific to this domain, with scheduled task reliability being the primary concern given OpenClaw's failure in this area.

1. **Scheduled Task Amnesia** — Tasks "forgotten" when process crashes mid-execution, queue state desynchronized. Prevention: Heartbeat mechanism where running agents send periodic heartbeats; monitor resets stalled tasks. Implement idempotency checks. Use SQLite WAL mode. Add scheduled task verification comparing scheduled vs. actual executions.

2. **Context Pollution and Memory Bloat** — Long conversations consume exponential tokens, degrade response quality. Research shows agents with combined context editing and memory tools completed 100-turn dialogues using only 16% of tokens otherwise required. Prevention: Sliding window (keep only recent N messages), compress medium-term memory, extract key facts to structured data, apply context editing before API calls.

3. **Webhook Timeout Cascade** — Long-running operations in webhook handler cause Telegram timeout and re-send, resulting in duplicate processing. Telegram has 60s timeout but grammY defaults to 10s. Prevention: Never perform long operations synchronously in webhook handler. Implement async delegation pattern with immediate 200 response and queue-based processing. Track update_id for deduplication.

4. **Single Process Single Point of Failure** — Process crash (OOM, unhandled error) leaves entire assistant unavailable until manual intervention. Bun has 34% native dependency compatibility issues. Prevention: Use systemd (not PM2) with Restart=always and exponential backoff. Implement graceful shutdown (SIGTERM/SIGINT). Use SQLite WAL mode. Add health checks and dead man's switch.

5. **Unbounded Sudo Access Security Risk** — AI agent with full sudo can execute destructive commands via misinterpreted intent or prompt injection. Prevention: Never grant sudo to agent process. Run as unprivileged user. Use command allowlist (not blocklist). Implement sandboxing. Require explicit user confirmation for elevated operations. Validate and sanitize all arguments.

6. **Syncthing Conflict Proliferation** — Simultaneous edits on multiple devices create `.sync-conflict-*` files that accumulate without resolution. Prevention: Implement conflict detection on startup and periodic scans. Use "last write wins" for agent-managed files. Notify user for user-created files with resolution options. Use file locking pattern (.lock files).

7. **LibSQL Sync Conflict Silent Data Loss** — LibSQL "last push wins" conflict resolution causes simultaneous writes to silently overwrite. Prevention: Use Turso for write-once/read-many data (conversation history, embeddings). Implement optimistic locking with version fields for mutable state. Batch writes in transactions. Use Telegram as source of truth for state.

8. **Agent SDK Session State Leakage** — Long-running sessions accumulate state (temp files, unclosed resources, memory caches) never cleaned up. Prevention: Implement explicit session lifecycle with cleanup on conversation end. Use session manager tracking resources. Periodic cleanup tasks. Set resource limits per session. Follow two-phase approach: initializer agent + coding agent with clear artifacts.

## Implications for Roadmap

Based on research, suggested phase structure prioritizes reliability foundations before feature breadth, with each phase addressing specific pitfalls and validating critical integrations.

### Phase 1: Core Infrastructure & Telegram Integration
**Rationale:** Establishes reliability foundations before adding complexity. Proves deployment, webhook setup, and async patterns that underpin all subsequent features. Addresses the most critical pitfall (webhook timeouts) and establishes security model from start.

**Delivers:** Functioning Telegram bot deployed to Hetzner VPS with basic chat responses, systemd process management with auto-restart, SQLite database with WAL mode, async delegation pattern with BunQueue embedded mode, single-user authentication middleware.

**Addresses features:** Text chat interface, reliable 24/7 uptime, privacy/security baseline

**Avoids pitfalls:** Webhook timeout cascade (async delegation), single process failure (systemd), unbounded sudo access (security model)

**Research flag:** LOW — grammY and deployment patterns well-documented with multiple examples

### Phase 2: Agent Integration & Conversation Management
**Rationale:** Core value proposition of intelligent responses. Validates Agent SDK in production before adding complex tool integrations. Establishes conversation context patterns that all features build upon.

**Delivers:** Claude Opus 4.6 integration via Agent SDK, streaming responses to Telegram, conversation context storage and retrieval, basic MCP tool registry, context window management with sliding window pattern.

**Uses stack:** Anthropic Agent SDK v0.2.38, Drizzle ORM for conversation storage

**Addresses features:** Natural language understanding, conversation history

**Avoids pitfalls:** Context pollution (sliding window from start), agent SDK session leakage (explicit lifecycle)

**Research flag:** MEDIUM — Agent SDK well-documented, but context management strategy needs production validation

### Phase 3: Reliable Scheduling System
**Rationale:** The primary motivation for Rachel8 rebuild. Must work flawlessly to validate project premise. Builds on established agent tools and async patterns from Phase 2.

**Delivers:** BunQueue embedded mode with heartbeat mechanism, reminder tool for agent (MCP), cron job support with DST handling, job persistence in SQLite, scheduled task monitoring and self-healing, idempotency checks.

**Uses stack:** BunQueue v2.4.0 embedded mode

**Addresses features:** Basic reminders/scheduling, recurring task reliability

**Avoids pitfalls:** Scheduled task amnesia (heartbeat + monitoring), task queue desync (idempotency)

**Research flag:** MEDIUM — BunQueue patterns documented, but heartbeat self-healing needs custom implementation

### Phase 4: File Management & Obsidian Integration
**Rationale:** Enables knowledge management features after core agent works reliably. Simpler than full Syncthing integration, establishes vault access patterns.

**Delivers:** Telegram file upload/download handler, file storage in vault directory, basic file organization tool (MCP), file metadata tracking in SQLite, agent Read/Write/Edit permissions for vault.

**Implements architecture:** File Manager component, vault persistence layer

**Addresses features:** File upload/download, Obsidian vault read access

**Avoids pitfalls:** Security controls (limit agent to vault directory)

**Research flag:** LOW — Standard file operations, Telegram upload well-documented

### Phase 5: Web Search & Proactive Features
**Rationale:** Enhances agent capabilities with external data. Proactive messaging requires scheduling system (Phase 3) and memory system foundation.

**Delivers:** Web search tool integration (Tavily or Perplexity API), basic proactive messaging with time-based triggers, notification quality controls to prevent fatigue, search result caching.

**Addresses features:** Web search capability, basic proactive messaging

**Avoids pitfalls:** Notification fatigue (quality over quantity, user-controlled frequency)

**Research flag:** LOW — Search API integrations straightforward, documented examples

### Phase 6: Syncthing Monitoring & Advanced File Features
**Rationale:** Most complex file integration. Depends on established file tools (Phase 4) and scheduling (Phase 3) for event handling.

**Delivers:** FS watcher with 10s debouncing, file change detection and event processing, agent-driven file organization, conflict detection and resolution, Obsidian vault write access with conflict handling.

**Implements architecture:** Syncthing Monitor component, automated organization workflows

**Addresses features:** Obsidian vault write access, context-aware file management

**Avoids pitfalls:** Syncthing conflict proliferation (detection + resolution), event spam (10s debounce)

**Research flag:** MEDIUM — Syncthing patterns documented, but conflict resolution strategy needs design

### Phase Ordering Rationale

- **Phase 1 before 2-6:** All features depend on reliable webhook handling and process management. Security model must be established before shell access or file operations.
- **Phase 2 before 3-6:** Scheduling, file operations, and proactive features all use agent tools via MCP server. Agent integration must work before adding tool complexity.
- **Phase 3 before 5:** Proactive messaging requires working scheduler. Validates queue reliability before adding file monitoring jobs (Phase 6).
- **Phase 4 before 6:** Syncthing integration builds on established file operation tools. Simple upload/download proves patterns before adding watch complexity.
- **Phase 5 parallel to 4 or after:** Web search can be implemented independently once agent tools work. Ordering flexible based on priority.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 2 (Agent Integration):** Context management strategy needs design work. Sliding window + compression approach well-documented, but retrieval strategy for older context needs experimentation. Consider lightweight semantic search options.
- **Phase 3 (Scheduling):** Heartbeat mechanism and self-healing need custom implementation beyond BunQueue defaults. Research task monitoring patterns and recovery strategies.
- **Phase 6 (Syncthing):** Conflict resolution strategy needs design. Multiple approaches possible (last-write-wins, user notification, file locking). Research Syncthing conflict patterns specific to Obsidian vault use case.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Infrastructure):** grammY webhook setup, systemd configuration, SQLite with Drizzle all have established patterns. Multiple examples exist.
- **Phase 4 (File Management):** Telegram file API and basic file operations well-documented. Standard CRUD patterns.
- **Phase 5 (Web Search):** Tavily and Perplexity APIs have straightforward integrations. Multiple examples in agent contexts.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core technologies verified with official docs and recent releases (Feb 2026). Version compatibility confirmed. Anthropic SDK, grammY, Bun, BunQueue all production-ready with high-quality documentation. |
| Features | MEDIUM-HIGH | Table stakes features well-established from competitor analysis and domain research. Prioritization matrix based on user value vs implementation cost. Some differentiation features (proactive messaging, shell execution) have fewer examples but clear patterns. |
| Architecture | HIGH | Standard patterns well-documented across multiple sources. Async delegation, embedded queue, streaming agent all have production examples. Component boundaries align with established microservices patterns adapted for single-process deployment. |
| Pitfalls | HIGH | Critical pitfalls identified from multiple production systems (OpenClaw failure analysis, grammY reliability docs, Anthropic agent best practices). Prevention strategies validated across sources. Recovery procedures tested in production environments. |

**Overall confidence:** HIGH

Research synthesized from official documentation, production systems analysis, and domain expert consensus. All core technologies have February 2026 releases with verified compatibility. Architecture patterns validated in production deployments. Pitfall analysis based on actual failure cases (OpenClaw task amnesia, webhook timeout patterns).

### Gaps to Address

Research was thorough for core systems, but some areas need validation during implementation:

- **Context management retrieval strategy:** Sliding window approach established, but semantic search for older context is optional optimization. Need to validate whether simple keyword search suffices or if embeddings required. Can start with recent-only, add retrieval incrementally based on actual conversation patterns.

- **Command allowlist design:** Security model established (no sudo, unprivileged user, command allowlist), but specific commands to allow need definition based on actual use cases. Start conservative with file operations in specific directories, expand as trust builds. Document allowlist expansion criteria.

- **Proactive messaging heuristics:** Research establishes "quality over quantity" and user control principles, but specific triggers for proactive messages need design. Start with explicit time-based reminders only, add pattern-based triggers after observing usage patterns.

- **LibSQL vs local SQLite decision:** Stack research presents both options (LibSQL with Turso for remote sync, standard SQLite for local-only). Single-user use case likely doesn't need remote sync initially. Decision point: start with local SQLite (simpler), migrate to LibSQL if multi-device sync needed. No architectural change required.

- **Conflict resolution preferences:** Syncthing conflict handling has multiple valid strategies. Research shows "last write wins" for agent-managed files and user notification for user-created files, but need per-directory configuration. Design conflict resolution rules during Phase 6 planning based on vault structure.

## Sources

### Primary (HIGH confidence)

**Official Documentation:**
- [Anthropic Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — Agent SDK API, MCP tools, sandboxing
- [grammY Official Documentation](https://grammy.dev/) — Telegram bot framework, deployment patterns, reliability guides
- [Bun Documentation](https://bun.com/docs) — Runtime, tooling, ecosystem integrations
- [BunQueue Official Site](https://bunqueue.dev/) — Queue system configuration, embedded mode
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/connect-bun-sqlite) — Bun SQLite integration
- [LibSQL Documentation](https://docs.turso.tech/libsql) — Database client, Turso sync

**Recent Releases (verified Feb 2026):**
- [Anthropic Agent SDK v0.2.38](https://github.com/anthropics/claude-agent-sdk-typescript/releases) — Latest TypeScript SDK
- [Bun v1.3.9](https://github.com/oven-sh/bun/releases) — Latest stable release
- [LibSQL Client v0.17.0](https://github.com/tursodatabase/libsql-client-ts) — Latest TypeScript client

**Anthropic Engineering Guides:**
- [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) — Official implementation patterns
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Session management, two-phase approach
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — Tool design patterns

### Secondary (MEDIUM confidence)

**Production Deployments:**
- [The Complete Guide to Building Agents with Anthropic Agent SDK](https://nader.substack.com/p/the-complete-guide-to-building-agents) — End-to-end implementation
- [Cloudflare Anthropic Patterns](https://github.com/cloudflare/agents/tree/main/guides/anthropic-patterns) — Production patterns
- [Clawdbot AI Architecture Analysis](https://medium.com/@gemQueenx/clawdbot-ai-the-revolutionary-open-source-personal-assistant-transforming-productivity-in-2026-6ec5fdb3084f) — Personal assistant patterns

**grammY and Telegram:**
- [Building a Telegram bot with grammY](https://blog.logrocket.com/building-telegram-bot-grammy/) — Implementation guide
- [Long Polling vs. Webhooks](https://grammy.dev/guide/deployment-types) — Deployment strategies
- [Scaling Up III: Reliability](https://grammy.dev/advanced/reliability) — Production reliability patterns

**BunQueue:**
- [BunQueue GitHub](https://github.com/egeominotti/bunqueue) — Source code, examples
- [Show HN: Bunqueue](https://news.ycombinator.com/item?id=46851518) — Community feedback
- [Queues in Node.JS and Bun](https://www.nathanbeddoe.com/blog/queues-in-nodejs-and-bun) — Queue system comparison

**Context and Memory Management:**
- [Memory for AI Agents: Context Engineering](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/) — Memory architecture patterns
- [Context Window Management for AI Agents](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — Sliding window strategies
- [Building AI Agents That Actually Remember](https://medium.com/@nomannayeem/building-ai-agents-that-actually-remember-a-developers-guide-to-memory-management-in-2025-062fd0be80a1) — Memory implementation guide

**Scheduling and Reliability:**
- [Why your AI agent needs a task queue](https://blog.logrocket.com/ai-agent-task-queues) — Queue patterns for agents
- [Building Reliable Tool Calling with Message Queues](https://www.inferable.ai/blog/posts/distributed-tool-calling-message-queues) — Distributed tool execution
- [AI Agent Reliability for Mission Critical Systems](https://galileo.ai/blog/ai-agent-reliability-strategies) — Production reliability strategies

**SQLite Concurrency:**
- [SQLite concurrent writes and database locked errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — WAL mode patterns
- [Multi-threaded SQLite without OperationalErrors](https://charlesleifer.com/blog/multi-threaded-sqlite-without-the-operationalerrors/) — Concurrency best practices

**Syncthing:**
- [Understanding Synchronization](https://docs.syncthing.net/users/syncing.html) — Sync model, conflict handling
- [syncthing-resolve-conflicts](https://github.com/dschrempf/syncthing-resolve-conflicts) — Automated conflict resolution
- [Syncthing Integration - Obsidian](https://www.obsidianstats.com/plugins/syncthing-integration) — Obsidian vault sync patterns

**Security and Sandboxing:**
- [Practical Security Guidance for Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk) — Agent sandboxing patterns
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing) — Anthropic sandbox implementation
- [How to Sandbox LLMs & AI Shell Tools](https://www.codeant.ai/blogs/agentic-rag-shell-sandboxing) — Command execution security

### Tertiary (LOW confidence, needs validation)

**Feature Prioritization:**
- [Best 9 Telegram Chatbots (2026)](https://botpress.com/blog/top-telegram-chatbots) — Feature landscape
- [10 Best AI Assistants in 2026](https://www.morgen.so/blog-posts/best-ai-planning-assistants) — Scheduling features
- [8 Best AI File Organizers](https://clickup.com/blog/ai-file-organizers/) — File management patterns

**Failure Analysis:**
- [The Biggest AI Fails of 2025](https://www.ninetwothree.co/blog/ai-fails) — Common failure modes
- [AI Adoption Challenges for 2025](https://www.stack-ai.com/blog/the-biggest-ai-adoption-challenges) — Pitfall patterns
- [Telegram JobQueue Bug](https://github.com/python-telegram-bot/python-telegram-bot/issues/1903) — Task scheduling failures

---
*Research completed: 2026-02-10*
*Ready for roadmap: yes*
