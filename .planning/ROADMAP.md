# Roadmap: Rachel8

## Overview

Rachel8 rebuilds a personal AI assistant from the ground up with one core promise: when told to do something at a specific time, she actually does it. The roadmap moves from reliable infrastructure through intelligent messaging to file management and shell access, validating each capability before building the next. Six phases deliver a single-user Telegram bot powered by Claude Opus 4.6, running 24/7 on a Hetzner VPS with deep Obsidian vault integration.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Deployment** - VPS setup, project scaffolding, systemd service
- [ ] **Phase 2: Telegram Integration & Auth** - grammY webhook, basic chat, single-user auth
- [ ] **Phase 3: Agent Intelligence** - Claude SDK integration, conversation memory, web search
- [ ] **Phase 4: Reliable Scheduling** - BunQueue with heartbeat, reminders, cron jobs, proactive messaging
- [ ] **Phase 5: File Management** - Telegram file handling, vault read/write, organization tools
- [ ] **Phase 6: Shell Access** - Full sudo command execution on VPS

## Phase Details

### Phase 1: Foundation & Deployment
**Goal**: VPS is provisioned, codebase structure exists, Rachel runs as systemd service with auto-restart
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05, SETUP-06, SETUP-07, SYS-03
**Success Criteria** (what must be TRUE):
  1. User can run one-liner install command that clones repo and launches setup wizard
  2. Setup wizard collects all API keys (Claude, Telegram bot token, Exa) with clear instructions
  3. Setup wizard detects or asks for shared folder path on VPS
  4. Rachel runs as systemd service and auto-restarts after crash or reboot
  5. README contains complete VPS setup instructions from zero to running
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffolding, config validation, logger
- [x] 01-02-PLAN.md — Setup wizard, validators, systemd installer, entry point
- [x] 01-03-PLAN.md — Install script, systemd service template, README

### Phase 2: Telegram Integration & Auth
**Goal**: User can send messages to Rachel via Telegram and receive intelligent responses, with single-user authentication enforced
**Depends on**: Phase 1
**Requirements**: MSG-01, MSG-02, SYS-01
**Success Criteria** (what must be TRUE):
  1. User can send text message to Rachel's Telegram bot and receive a response
  2. Rachel shows typing indicator while processing messages
  3. Only the owner's Telegram user ID can interact with Rachel (single-user auth works)
  4. Messages from unauthorized users are ignored or receive rejection message
**Plans**: TBD

Plans:
- TBD

### Phase 3: Agent Intelligence
**Goal**: Rachel maintains conversation context, searches the web for information, and writes important facts to vault for long-term memory
**Depends on**: Phase 2
**Requirements**: INTEL-01, INTEL-02, INTEL-03
**Success Criteria** (what must be TRUE):
  1. User can have multi-turn conversation where Rachel remembers context from earlier in thread
  2. User can ask Rachel to search the web and she returns relevant results using Exa
  3. Rachel writes important information to vault notes that persist across process restarts
  4. User can query Rachel about information she previously wrote to vault
**Plans**: TBD

Plans:
- TBD

### Phase 4: Reliable Scheduling
**Goal**: User can create reminders and recurring tasks from natural language, tasks persist across restarts, and Rachel proactively messages when jobs fire
**Depends on**: Phase 3
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05, MSG-03
**Success Criteria** (what must be TRUE):
  1. User can say "remind me Monday to call David" and Rachel creates a real BunQueue job
  2. User can create recurring tasks with daily, weekly, or custom cron schedules
  3. User can view all scheduled tasks and their next execution times
  4. User can cancel or modify scheduled tasks from Telegram
  5. Scheduled tasks survive process restarts and still fire at correct times
  6. Rachel sends proactive messages when scheduled jobs fire (not just responding)
**Plans**: TBD

Plans:
- TBD

### Phase 5: File Management
**Goal**: User can send files to Rachel for storage in shared vault, retrieve files from vault via Telegram, and Rachel can read/organize vault contents
**Depends on**: Phase 4
**Requirements**: FILE-01, FILE-02, FILE-03, FILE-04
**Success Criteria** (what must be TRUE):
  1. User can send files and photos to Rachel via Telegram and they appear in shared vault
  2. User can ask Rachel to send a file from vault and receive it via Telegram
  3. Rachel can browse and read files in Obsidian vault directory structure
  4. Rachel can create, edit, and organize files in vault (move between folders)
**Plans**: TBD

Plans:
- TBD

### Phase 6: Shell Access
**Goal**: Rachel can execute any shell command on VPS with full sudo access
**Depends on**: Phase 5
**Requirements**: SYS-02
**Success Criteria** (what must be TRUE):
  1. User can ask Rachel to run shell commands and she executes them on VPS
  2. Rachel has full sudo access with no restrictions
  3. Rachel reports command output back via Telegram with success/failure status
**Plans**: TBD

Plans:
- TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Deployment | 3/3 | ✓ Complete | 2026-02-10 |
| 2. Telegram Integration & Auth | 0/TBD | Not started | - |
| 3. Agent Intelligence | 0/TBD | Not started | - |
| 4. Reliable Scheduling | 0/TBD | Not started | - |
| 5. File Management | 0/TBD | Not started | - |
| 6. Shell Access | 0/TBD | Not started | - |
