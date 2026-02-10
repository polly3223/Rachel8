# Requirements: Rachel8

**Defined:** 2026-02-10
**Core Value:** When Rachel is told to do something at a specific time, she does it — no forgetting, no excuses.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Messaging

- [ ] **MSG-01**: User can send text messages to Rachel via Telegram and receive intelligent responses
- [ ] **MSG-02**: Rachel shows typing indicator while processing a message
- [ ] **MSG-03**: Rachel can send proactive messages when scheduled jobs fire (not just respond)

### Scheduling

- [ ] **SCHED-01**: User can create reminders from natural language ("remind me Monday to call David") and Rachel creates a real BunQueue job
- [ ] **SCHED-02**: User can create recurring scheduled tasks (daily, weekly, custom cron expressions)
- [ ] **SCHED-03**: User can view all scheduled tasks and their next execution time
- [ ] **SCHED-04**: User can cancel or modify scheduled tasks
- [ ] **SCHED-05**: Scheduled tasks persist across process restarts (BunQueue SQLite-backed)

### File Management

- [ ] **FILE-01**: User can send files and photos to Rachel via Telegram and they are saved to the shared vault
- [ ] **FILE-02**: Rachel can send files from the shared vault back to the user via Telegram
- [ ] **FILE-03**: Rachel can read and browse files in the Obsidian vault
- [ ] **FILE-04**: Rachel can create, edit, and organize files in the Obsidian vault

### Agent Intelligence

- [ ] **INTEL-01**: Rachel maintains conversation history within a thread for context continuity
- [ ] **INTEL-02**: Rachel can search the web using Exa to answer questions or look things up
- [ ] **INTEL-03**: Rachel writes important information to vault notes for long-term memory across sessions

### System

- [ ] **SYS-01**: Rachel only responds to the owner's Telegram user ID (single-user auth)
- [ ] **SYS-02**: Rachel can execute shell commands on the VPS with full sudo access
- [ ] **SYS-03**: Rachel runs as a systemd service with auto-restart on crash

### Setup & Deployment

- [ ] **SETUP-01**: One-liner install command that clones repo (via gh) and launches interactive setup wizard
- [ ] **SETUP-02**: Setup wizard asks for Claude API key (with instructions on where to get it)
- [ ] **SETUP-03**: Setup wizard asks for Telegram bot token (with step-by-step BotFather instructions in CLI)
- [ ] **SETUP-07**: Setup wizard asks for Exa API key (with instructions on where to get it)
- [ ] **SETUP-04**: Setup wizard auto-detects `/shared` directory on VPS root; if missing, asks for shared folder path
- [ ] **SETUP-05**: Setup wizard configures systemd service and starts Rachel automatically
- [ ] **SETUP-06**: README contains clear VPS setup section: install gh, create shared folder, configure Syncthing, copy-paste one-liner

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Voice

- **VOICE-01**: User can send voice messages and Rachel transcribes and responds
- **VOICE-02**: Rachel can respond with voice messages (text-to-speech)

### Advanced Intelligence

- **ADV-01**: Rachel monitors vault inbox for new files and auto-organizes them
- **ADV-02**: Rachel uses semantic search across conversation history for better long-term recall
- **ADV-03**: Rachel detects and resolves Syncthing conflict files

### Multi-modal

- **MULTI-01**: Rachel can analyze images sent via Telegram (vision model)
- **MULTI-02**: Rachel can parse and summarize PDF documents

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user support | Single-user personal assistant — no auth/permissions complexity |
| Mobile app | Telegram IS the mobile and desktop app |
| Mastra framework | Replaced by Claude Agent SDK |
| Command allowlisting/sandboxing | Owner trusts Rachel with full sudo — no restrictions |
| Real-time vault monitoring (v1) | On-demand vault access only; auto-monitoring deferred to v2 |
| Voice messages | Text-only for v1; voice adds transcription complexity |
| OAuth/external integrations | Telegram is the only interface |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETUP-01 | Phase 1 | Pending |
| SETUP-02 | Phase 1 | Pending |
| SETUP-03 | Phase 1 | Pending |
| SETUP-04 | Phase 1 | Pending |
| SETUP-05 | Phase 1 | Pending |
| SETUP-06 | Phase 1 | Pending |
| SETUP-07 | Phase 1 | Pending |
| SYS-03 | Phase 1 | Pending |
| MSG-01 | Phase 2 | Pending |
| MSG-02 | Phase 2 | Pending |
| SYS-01 | Phase 2 | Pending |
| INTEL-01 | Phase 3 | Pending |
| INTEL-02 | Phase 3 | Pending |
| INTEL-03 | Phase 3 | Pending |
| SCHED-01 | Phase 4 | Pending |
| SCHED-02 | Phase 4 | Pending |
| SCHED-03 | Phase 4 | Pending |
| SCHED-04 | Phase 4 | Pending |
| SCHED-05 | Phase 4 | Pending |
| MSG-03 | Phase 4 | Pending |
| FILE-01 | Phase 5 | Pending |
| FILE-02 | Phase 5 | Pending |
| FILE-03 | Phase 5 | Pending |
| FILE-04 | Phase 5 | Pending |
| SYS-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-10*
*Last updated: 2026-02-10 after roadmap creation*
