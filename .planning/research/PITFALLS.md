# Pitfalls Research

**Domain:** Personal AI Assistant with Telegram Interface
**Researched:** 2026-02-10
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Scheduled Task Amnesia

**What goes wrong:**
The agent "forgets" to execute scheduled tasks, leaving reminders and scheduled operations silently unfulfilled. This was the primary pain point that motivated the Rachel8 rebuild from OpenClaw.

**Why it happens:**
Task queue state becomes desynchronized from actual execution. Common root causes:
- Process crashes before marking task as complete, leaving task claimed forever with no agent working on it
- SQLite database locks preventing task status updates during concurrent operations
- No heartbeat mechanism to detect when an agent dies mid-execution
- Task context not fully serialized in queue, requiring reconstruction that fails

**How to avoid:**
- Implement heartbeat mechanism where running agents send periodic heartbeats; separate monitor checks timestamps and resets tasks claimed for extended periods with no heartbeat back to ready state
- Use SQLite WAL mode to reduce lock contention
- Store complete execution context in queue entry (not references that can become stale)
- Implement idempotency checks so retried tasks detect if already completed
- Add scheduled task verification: periodic scan comparing scheduled tasks vs. actual executions, logging discrepancies

**Warning signs:**
- Tasks stuck in "claimed" or "running" state indefinitely
- Database lock errors (`SQLITE_BUSY`) in logs during queue operations
- Scheduled tasks that execute multiple times or never execute
- Time drift between scheduled time and actual execution time growing over hours

**Phase to address:**
Phase 1 (Core Infrastructure): Design queue architecture with heartbeat mechanism from start. Phase 2 (Scheduling System): Implement comprehensive monitoring and self-healing for task execution.

---

### Pitfall 2: Context Pollution and Memory Bloat

**What goes wrong:**
Long-running conversations consume exponentially more tokens and degrade response quality as context grows. Agent responses become inaccurate or unreliable due to "context rot" where simply enlarging context windows results in degraded performance.

**Why it happens:**
Without context management, agents carry forward all previous conversation turns verbatim. For a single-user personal assistant with ongoing conversations spanning days or weeks, this becomes unsustainable. The agent loses coherence trying to process thousands of lines of chat history for simple queries.

**How to avoid:**
- Implement sliding window memory: keep only most recent N messages as context, oldest messages get dropped
- Use compression for medium-term memory: compress summaries of recent sessions rather than storing verbatim
- Extract key facts to long-term memory (LibSQL) as structured data, not raw conversation
- Apply context editing before each API call to remove unnecessary content
- When Anthropic combined context editing and memory tools in evaluations, agents completed 100-turn dialogues using only 16% of tokens otherwise required

**Warning signs:**
- API calls taking progressively longer as conversation continues
- Token costs increasing linearly or exponentially over session duration
- Agent responses becoming less relevant to recent context
- Memory (RAM) usage growing continuously over days
- Hitting Claude API context window limits (200K tokens)

**Phase to address:**
Phase 3 (Memory System): Design three-tier memory architecture (short/medium/long-term) with compression and pruning strategies from the start.

---

### Pitfall 3: Webhook Timeout Cascade

**What goes wrong:**
Long-running agent operations in webhook handlers cause Telegram to timeout and re-send the update, resulting in duplicate processing. User sends one message, agent processes it twice, causing duplicate scheduled tasks, double file operations, or inconsistent state.

**Why it happens:**
Telegram has a timeout for each webhook update (typically 60 seconds, but grammY's internal timeout defaults to 10 seconds). Operations like large file processing, complex Claude API calls, or shell commands exceed this timeout. Telegram assumes update wasn't delivered and re-sends it.

**How to avoid:**
- Never perform long-running operations synchronously in webhook handler
- Implement task queue pattern: webhook handler immediately acknowledges with HTTP 200, enqueues work for background processing
- Use grammY's built-in timeout configuration, but design for async processing regardless
- Implement deduplication using update_id: track processed update IDs in database, skip if already seen
- For operations taking >5 seconds, send immediate "working on it" response to user, then process and send result when complete

**Warning signs:**
- Duplicate log entries for same update_id
- Users reporting "the bot did that twice"
- HTTP timeout errors in Telegram webhook logs
- Telegram stops sending updates after repeated failures
- Update queue backing up in Telegram's servers

**Phase to address:**
Phase 1 (Core Infrastructure): Design webhook handler with queue-based async processing from start. Phase 2 (Telegram Integration): Implement deduplication and proper timeout handling.

---

### Pitfall 4: Single Process Single Point of Failure

**What goes wrong:**
Single Bun process crashes (OOM, unhandled error, system issue), and entire assistant becomes unavailable until manual intervention. No automatic recovery. Scheduled tasks don't run, user messages go unanswered, proactive notifications never sent.

**Why it happens:**
Running as single process without process manager or automatic restart mechanism. Common crash causes:
- Memory leak causing OOM kill
- Unhandled promise rejection in async code
- SQLite corruption after unclean shutdown
- Node-compatible package incompatibility with Bun (34% native dependency compatibility rate)

**How to avoid:**
- Use systemd for production deployment (more reliable than PM2 for this use case)
- Configure systemd with `Restart=always`, `RestartSec=10s`, exponential backoff
- Implement graceful shutdown: catch SIGTERM/SIGINT, flush queues, close DB connections cleanly
- Add process health checks: systemd can restart if health endpoint fails
- Use SQLite WAL mode to prevent corruption on crashes
- Log crashes with context (memory usage, last operation, stack trace)
- Set up dead man's switch: if process doesn't send heartbeat to external monitor for N minutes, trigger alert

**Warning signs:**
- Process runs for days then suddenly stops
- Memory usage growing over time (memory leak)
- SQLite "database is malformed" errors after restart
- Logs show unhandled promise rejections or uncaught exceptions
- systemd shows repeated restart attempts in journalctl

**Phase to address:**
Phase 1 (Core Infrastructure): Implement systemd integration, graceful shutdown, and health checks. Phase 4 (Reliability): Add comprehensive monitoring and alerting.

---

### Pitfall 5: Unbounded Sudo Access Security Risk

**What goes wrong:**
AI agent with full sudo access can execute destructive commands based on misinterpreted intent or prompt injection. User asks "clean up old files" and agent runs `sudo rm -rf /` or similar catastrophic command. Or malicious input in file content causes agent to execute attacker-controlled commands.

**Why it happens:**
The project specifies "full sudo access" on VPS, but AI agents should never have elevated privileges. When LLM is allowed to run shell commands, a single malicious prompt or subtle input manipulation can lead to unauthorized file access or system changes. Anthropic Agent SDK provides shell execution tools, but these should run in restricted context.

**How to avoid:**
- Never grant sudo access to the agent process itself
- Run agent as unprivileged user with minimal permissions
- Use allowlist approach for commands: define explicit set of safe commands agent can run (file operations in specific directories, safe info commands like `df -h`, `uptime`)
- Implement command sandboxing: use container-based isolation or restricted user account
- For operations requiring elevated privileges (system maintenance), require explicit user confirmation via Telegram before execution
- Validate and sanitize all command arguments, never pass user input directly to shell
- Log all shell command executions for audit trail

**Warning signs:**
- Agent attempting to execute commands outside allowed directories
- Shell commands with suspicious patterns (`..; rm -rf`, `curl | bash`, etc.)
- File access denied errors showing agent tried to access system directories
- Agent process running as root in `ps aux`

**Phase to address:**
Phase 1 (Core Infrastructure): Design security model with restricted user and command allowlist from start. Phase 2 (Shell Integration): Implement sandboxed execution with explicit confirmation for privileged operations.

---

### Pitfall 6: Syncthing Conflict Proliferation

**What goes wrong:**
Syncthing shared folder accumulates `.sync-conflict-*` files that agent doesn't know how to handle. User modifies file on mobile while agent modifies same file on VPS, creating conflicts that multiply over time. Agent operations fail when encountering conflict files, or agent uses wrong version of file.

**Why it happens:**
When file modified on two devices simultaneously and content differs, Syncthing creates conflict file with older modification time renamed as `<filename>.sync-conflict-<date>-<time>-<modifiedBy>.<ext>`. Conflict files are propagated between all devices because conflict is detected and resolved on one device but it's a conflict everywhere. Without automated conflict resolution, these accumulate.

**How to avoid:**
- Implement conflict detection on agent startup and periodic scans: find files matching `*.sync-conflict-*` pattern
- For agent-managed files, use "last write wins" strategy: agent always prefers non-conflict version, logs conflict occurrence
- For user-created files, notify user via Telegram when conflicts detected with options: keep original, keep conflict version, merge (for text files), or view diff
- Use file locking pattern: agent creates `.lock` file before modifying, checks for lock before modifications, removes after complete
- Automate with syncthing-resolve-conflicts script pattern: scheduled cleanup checking for conflicts and applying resolution rules
- Store conflict resolution preferences per directory/file pattern in config

**Warning signs:**
- Multiple `.sync-conflict-*` files accumulating in shared folders
- Agent logs showing file read failures with conflict filenames
- User reports "file I edited disappeared" or "changes lost"
- Syncthing logs showing rapid conflict creation cycles

**Phase to address:**
Phase 2 (File Management): Implement conflict detection and resolution strategy. Phase 4 (Reliability): Add automated monitoring and cleanup.

---

### Pitfall 7: LibSQL Sync Conflict Silent Data Loss

**What goes wrong:**
LibSQL embedded replica syncing to Turso remote uses "last push wins" conflict resolution. Simultaneous writes from multiple sessions (user on mobile, agent on VPS) result in one set of changes silently overwritten. User's conversation memory or scheduled tasks vanish without warning.

**Why it happens:**
Turso's default conflict resolution is "last push wins" - when simultaneous writers occur, first push goes through, second push overwrites. Without custom conflict resolution hooks, there's no merge logic or conflict detection for application data. For personal AI assistant with user interacting via multiple devices, this creates race conditions.

**How to avoid:**
- Use Turso primarily for write-once/read-many data: conversation history, embeddings, completed tasks (immutable records)
- For mutable state (pending tasks, preferences), implement optimistic locking: version field incremented on each update, update only succeeds if version matches
- Implement custom conflict resolution using Turso's transform hook: detects conflicts and applies merge logic (e.g., union for task lists, last-write-wins for preferences with timestamp)
- Batch writes and use transactions to reduce conflict window
- For single-user assistant, rely on Telegram as source of truth: user's Telegram client state takes precedence over agent-initiated changes
- Add conflict detection logs: track when LibSQL sync returns conflict errors, alert if threshold exceeded

**Warning signs:**
- User reports "I added a reminder but it's gone"
- Inconsistent task lists between Telegram queries
- LibSQL sync errors in logs about conflicts
- Same conversation ID having different message counts in local vs remote
- Sync lag growing (indicates potential conflict backlog)

**Phase to address:**
Phase 3 (Memory System): Design data model favoring immutable records and implement optimistic locking for mutable state. Phase 4 (Reliability): Add conflict monitoring.

---

### Pitfall 8: Agent SDK Session State Leakage

**What goes wrong:**
Long-running agent sessions accumulate state (temporary files, unclosed resources, in-memory caches) that never gets cleaned up. Over days or weeks, this causes memory leaks, disk space exhaustion, or stale state affecting responses.

**Why it happens:**
Anthropic Agent SDK designed for discrete sessions with no memory of what came before. However, Rachel8 runs as single persistent process. Without explicit session boundaries and cleanup, resources accumulate. Common leaks include:
- Tool execution outputs cached in memory
- Temporary files from file processing not deleted
- Database connections not released
- WebSearch result caches growing unbounded

**How to avoid:**
- Implement explicit session lifecycle: create new session per Telegram conversation with user, clean up when conversation ends (timeout after inactivity)
- Use session manager that tracks resources allocated per session: files created, DB connections opened, memory buffers
- Implement periodic cleanup task: scan for orphaned temp files, clear caches, force garbage collection
- Set resource limits per session: max memory, max temp disk usage, auto-cleanup when exceeded
- For Anthropic Agent SDK, follow two-phase approach: initializer agent sets up environment on first run, coding agent makes incremental progress and leaves clear artifacts
- Monitor memory usage trends: alert if RSS grows consistently over time (memory leak indicator)

**Warning signs:**
- Process memory usage growing linearly over days
- `/tmp` or workspace directory accumulating files
- Slow response times as process runs longer (cache bloat)
- "Too many open files" errors
- Bun runtime showing increasing garbage collection times

**Phase to address:**
Phase 1 (Core Infrastructure): Design session lifecycle with explicit cleanup. Phase 3 (Agent Integration): Implement resource tracking per conversation.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Polling instead of webhooks | Simpler setup, no SSL/domain needed | Higher latency, more resource usage, scales poorly | MVP/development only; switch before production |
| Single SQLite file for all data | Simple schema, single file backup | Lock contention at scale, no separation of concerns | Acceptable if using WAL mode and proper indexing |
| Storing full conversation in context | No need for memory architecture | Context pollution, exponential token costs | Only for MVP testing; must refactor before daily use |
| PM2 instead of systemd | Easier to set up, nice dashboard | Extra layer of failure, less robust logging | Never for single-process VPS; systemd is simpler |
| No task deduplication | Faster webhook handler | Silent duplicate operations | Never acceptable; implement from start |
| Agent running as root | No permission errors | Catastrophic security risk | Never acceptable; always use unprivileged user |
| No heartbeat for scheduled tasks | Simpler queue implementation | Silent task loss on crashes | Never acceptable; motivated entire rebuild |
| Synchronous Claude API calls | Simpler code flow | Webhook timeouts, blocking | Never in webhook handler; always async with queue |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Telegram Webhooks | Long-running operations in webhook handler | Immediate 200 response, queue work for background processing |
| Claude API | No retry logic for rate limits | Exponential backoff with jitter, respect retry-after header |
| SQLite | Using default rollback journal mode | Use WAL mode for concurrent read/write, set busy_timeout |
| Syncthing | Ignoring conflict files | Automated detection and resolution with user notification |
| LibSQL/Turso | Assuming automatic conflict resolution | Implement optimistic locking for mutable data |
| BunQueue | Assuming tasks are atomic | Implement idempotency checks and heartbeat mechanism |
| grammY Context | Storing state in context object between updates | Use external state store (database), context is per-update |
| Shell Commands | Passing user input directly to exec | Allowlist commands, sanitize arguments, sandbox execution |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading full conversation history into context | Slow responses, high token costs | Sliding window + summarization | >100 messages (~50K tokens) |
| Synchronous database queries in webhook | Slow response times, timeouts | Queue pattern with async processing | >10 concurrent users (single user unlikely to hit) |
| No connection pooling for LibSQL | "Too many connections" errors | Use connection pool, limit concurrent | >50 concurrent operations |
| Unbounded file size in Syncthing operations | Memory exhaustion, crashes | Stream processing, size limits, chunking | Files >100MB |
| No rate limiting on Claude API calls | 429 errors, failed operations | Token bucket pattern, queue with rate limiting | >50 RPM (depends on API tier) |
| Storing embeddings in JSON text | Slow similarity search | Use proper vector columns in LibSQL | >1000 embedded items |
| Full table scans for scheduled tasks | Slow task polling, high CPU | Index on execution_time and status | >1000 scheduled tasks |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Agent process with sudo access | Full system compromise from prompt injection | Run as unprivileged user, command allowlist |
| No Telegram user ID verification | Anyone who discovers bot can use it | Check user.id against authorized user whitelist |
| Storing API keys in code | Credential exposure in Syncthing/git | Use environment variables, .env file in .gitignore |
| No validation on shell command args | Command injection attacks | Sanitize inputs, use allowlist, no shell=true |
| Webhook without secret token | Attacker can send fake updates | Set webhook with secret_token, verify in handler |
| Readable SQLite database with sensitive data | Credential exposure if VPS compromised | Encrypt at rest using SQLCipher or application-level encryption |
| Logging sensitive user messages | Privacy violation, log file exposure | Sanitize logs, use log rotation, limit retention |
| No network egress controls | Data exfiltration, remote code execution | Firewall rules limiting agent's outbound connections |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No "working on it" feedback | User thinks bot is broken, sends duplicate requests | Immediate ack with "working..." status |
| Silent failure on scheduled tasks | User loses trust, doesn't know what happened | Notify on both success and failure of scheduled operations |
| Proactive messages without context | User confused by random notifications | Include context: "You asked me to remind you..." |
| No way to cancel in-progress operations | User frustrated waiting for wrong operation | Provide /cancel command that gracefully stops current operation |
| Generic error messages | User doesn't know what to do | Specific error with recovery suggestion: "File too large (50MB). Try files under 10MB." |
| No confirmation for destructive ops | Accidental data loss | Require explicit confirmation for delete, modify, shell commands |
| Lost conversation state after restart | User has to re-explain context | Persist conversation state, restore on startup |
| No visibility into scheduled tasks | User doesn't remember what's scheduled | Provide /tasks command showing all scheduled operations |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Scheduled Tasks:** Often missing heartbeat mechanism and self-healing — verify tasks recover from process crashes
- [ ] **Webhook Integration:** Often missing deduplication and async processing — verify no duplicate operations and no timeouts
- [ ] **Memory System:** Often missing pruning/compression — verify memory doesn't grow unbounded over days
- [ ] **Error Handling:** Often missing user-friendly error messages — verify user gets actionable feedback, not stack traces
- [ ] **Security:** Often missing command sandboxing — verify agent can't execute arbitrary shell commands
- [ ] **File Operations:** Often missing conflict resolution — verify Syncthing conflicts are detected and handled
- [ ] **Database Operations:** Often missing WAL mode and busy_timeout — verify no SQLITE_BUSY errors under concurrent load
- [ ] **Process Management:** Often missing graceful shutdown — verify clean restarts don't corrupt SQLite or lose in-flight tasks
- [ ] **Rate Limiting:** Often missing exponential backoff — verify Claude API 429 errors are handled with retry-after header
- [ ] **Resource Cleanup:** Often missing temp file cleanup — verify /tmp doesn't accumulate files over days
- [ ] **Monitoring:** Often missing health checks — verify systemd can detect and restart unhealthy process
- [ ] **Logging:** Often missing context and sanitization — verify logs have enough context for debugging but don't expose secrets

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Scheduled task amnesia | LOW | 1. Query queue for stuck tasks (claimed >1hr) 2. Reset to ready state 3. Manual trigger if time-critical |
| Context pollution | LOW | 1. Clear conversation context 2. Rebuild summary from last N messages 3. User interaction continues normally |
| Webhook timeout cascade | MEDIUM | 1. Clear Telegram's update queue (stop/start bot) 2. Clear BunQueue to prevent duplicate processing 3. Verify deduplication working |
| Single process crash | LOW | 1. systemd auto-restarts 2. Check logs for crash cause 3. Scheduled tasks auto-recover via heartbeat timeout |
| Security breach (sudo abuse) | HIGH | 1. Kill agent process 2. Audit command logs for damage 3. Restore from backup if needed 4. Redeploy with restrictions |
| Syncthing conflict proliferation | LOW | 1. Run conflict resolution script 2. Review and merge/discard conflicts 3. Notify user of data loss if any |
| LibSQL sync conflict | MEDIUM | 1. Identify conflicting records via version mismatch 2. Manual merge if critical data 3. Rely on Telegram as source of truth |
| Agent SDK session leak | MEDIUM | 1. Restart process (releases resources) 2. Enable monitoring to prevent recurrence 3. Add periodic cleanup if leak persists |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Scheduled task amnesia | Phase 1: Core Infrastructure (heartbeat), Phase 2: Scheduling (monitoring) | Simulate crash during task execution, verify auto-recovery |
| Context pollution | Phase 3: Memory System | Run 100-turn conversation, verify token usage stays constant |
| Webhook timeout cascade | Phase 1: Core Infrastructure (queue), Phase 2: Telegram Integration | Send request requiring 30s processing, verify no duplicate |
| Single process crash | Phase 1: Core Infrastructure (systemd) | Kill process, verify auto-restart and task recovery |
| Unbounded sudo access | Phase 1: Core Infrastructure (security model) | Attempt restricted command, verify rejection |
| Syncthing conflict proliferation | Phase 2: File Management | Modify same file simultaneously, verify conflict detected |
| LibSQL sync conflict | Phase 3: Memory System | Simultaneous writes from two sessions, verify merge logic |
| Agent SDK session leak | Phase 1: Core Infrastructure (lifecycle), Phase 3: Agent Integration | Run for 7 days, verify memory usage stable |

## Sources

### Agent SDK and Long-Running Agents
- [Anthropic: Building agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [The Complete Guide to Building Agents with Anthropic Agent SDK](https://gist.github.com/dabit3/93a5afe8171753d0dbfd41c80033171d)

### grammY and Telegram Bots
- [grammY: Long Polling vs. Webhooks](https://grammy.dev/guide/deployment-types)
- [grammY: Deployment Checklist](https://grammy.dev/advanced/deployment)
- [grammY: Scaling Up III: Reliability](https://grammy.dev/advanced/reliability)
- [grammY: Bot API](https://grammy.dev/guide/api)

### Task Queue and Scheduling Reliability
- [LogRocket: Why your AI agent needs a task queue](https://blog.logrocket.com/ai-agent-task-queues)
- [Inferable: Building Reliable Tool Calling in AI Agents with Message Queues](https://www.inferable.ai/blog/posts/distributed-tool-calling-message-queues)
- [Galileo: A Guide to AI Agent Reliability for Mission Critical Systems](https://galileo.ai/blog/ai-agent-reliability-strategies)

### SQLite Concurrency and Locking
- [SQLite concurrent writes and database is locked errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/)
- [SQLite: File Locking And Concurrency](https://sqlite.org/lockingv3.html)
- [Charles Leifer: Multi-threaded SQLite without the OperationalErrors](https://charlesleifer.com/blog/multi-threaded-sqlite-without-the-operationalerrors/)
- [Skoumal: Parallel read and write in SQLite](https://www.skoumal.com/en/parallel-read-and-write-in-sqlite/)

### Context Management and Memory
- [The New Stack: Memory for AI Agents: A New Paradigm of Context Engineering](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/)
- [GetMaxim: Context Window Management for AI Agents and Chatbots](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/)
- [IBM: What Is AI Agent Memory?](https://www.ibm.com/think/topics/ai-agent-memory)
- [Medium: Memory Optimization Strategies in AI Agents](https://medium.com/@nirdiamant21/memory-optimization-strategies-in-ai-agents-1f75f8180d64)

### Bun Production Deployment
- [OneUptime: How to Deploy Bun Applications to Production](https://oneuptime.com/blog/post/2026-01-31-bun-production-deployment/view)
- [Bun: Run Bun as a daemon with PM2](https://bun.com/docs/guides/ecosystem/pm2)
- [byteiota: Migrating from Node.js to Bun 1.1: Production Guide](https://byteiota.com/migrating-from-node-js-to-bun-1-1-production-guide/)

### Process Management (systemd vs PM2)
- [xeg.io: Why PM2 is Preferred Over systemctl for Node.js Applications](https://www.xeg.io/shared-searches/why-pm2-is-preferred-over-systemctl-for-nodejs-applications-67078e84899198cfc914d3f5)
- [CloudBees: Running Node.js on Linux with systemd](https://www.cloudbees.com/blog/running-node-js-linux-systemd)
- [Pavel Romanov: Rethinking PM2: A Critical Evaluation](https://pavel-romanov.com/think-twice-before-using-pm2-a-critical-look-at-the-popular-tool)
- [DoHost: Implementing Service Recovery and Restart Policies in systemd](https://dohost.us/index.php/2025/10/27/implementing-service-recovery-and-restart-policies-in-systemd/)

### Claude API Rate Limiting
- [Anthropic: Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [AI Free API: How to Fix Claude API 429 Rate Limit Error](https://www.aifreeapi.com/en/posts/fix-claude-api-429-rate-limit-error)
- [HashBuilds: Claude API Rate Limits: Production Scaling Guide](https://www.hashbuilds.com/articles/claude-api-rate-limits-production-scaling-guide-for-saas)

### LibSQL/Turso Sync
- [Turso: Introducing Databases Anywhere with Turso Sync](https://turso.tech/blog/introducing-databases-anywhere-with-turso-sync)
- [Turso: Introducing Offline Writes for Turso](https://turso.tech/blog/introducing-offline-writes-for-turso)
- [Kite Metric: Turso Offline Sync: Build Resilient, Offline-First Apps](https://kitemetric.com/blogs/unlocking-the-power-of-offline-sync-with-turso)

### Syncthing Conflicts
- [Syncthing: Understanding Synchronization](https://docs.syncthing.net/users/syncing.html)
- [GitHub: syncthing-resolve-conflicts](https://github.com/dschrempf/syncthing-resolve-conflicts)
- [Syncthing Forum: How does conflict resolution work?](https://forum.syncthing.net/t/how-does-conflict-resolution-work/15113)

### Security and Sandboxing
- [NVIDIA: Practical Security Guidance for Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk)
- [Claude Code: Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [CodeAnt: How to Sandbox LLMs & AI Shell Tools](https://www.codeant.ai/blogs/agentic-rag-shell-sandboxing)
- [Botpress: Chatbot Security Guide: Risks & Guardrails (2026)](https://botpress.com/blog/chatbot-security)

---
*Pitfalls research for: Rachel8 Personal AI Assistant*
*Researched: 2026-02-10*
