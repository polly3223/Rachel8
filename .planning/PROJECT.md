# Rachel8

## What This Is

A personal AI assistant that lives on Telegram, powered by Claude Opus 4.6 via Anthropic's Agent SDK. Rachel runs on a Hetzner VPS with full sudo access, manages a shared Obsidian vault via Syncthing, and handles scheduled tasks reliably through BunQueue. Built for a single user (Lory) as a clean replacement for a previous OpenClaw-based version that was messy and unreliable with recurring tasks.

## Core Value

When Rachel is told to do something at a specific time, she does it — no forgetting, no excuses. Scheduled tasks are real BunQueue jobs, not LLM memory.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Text messaging via Telegram (send/receive through grammY webhook)
- [ ] Reliable scheduled tasks and reminders via BunQueue (crons, delayed jobs)
- [ ] Proactive messaging — Rachel initiates conversations when scheduled jobs fire
- [ ] File receiving — accept files/photos from Telegram, save to shared vault
- [ ] File sending — send files from shared vault back via Telegram
- [ ] Shared vault organization — monitor inbox, file and organize documents
- [ ] Shell command execution — run arbitrary commands on VPS with full sudo
- [ ] Web search — look things up online
- [ ] Conversation memory — thread-based history for recent context
- [ ] Long-term memory — write notes to vault for persistent recall across sessions
- [ ] Typing indicators — show appropriate chat actions while processing

### Out of Scope

- Voice messages — text only for v1, defer voice to future version
- Multi-user support — single user (Lory) only, no auth/access control needed
- Mastra framework — replaced entirely by Claude Agent SDK
- OAuth/external integrations — keep it simple, Telegram is the only interface
- Mobile app — Telegram IS the mobile (and desktop) app

## Context

- **Previous version:** OpenClaw installation (https://github.com/openclaw/openclaw). Worked but codebase was bloated, hard to extend, and the recurring task system was unreliable — the agent would "forget" daily tasks.
- **Architecture reference:** Lory wrote an initial architecture doc at `~/Documents/RachelShared/vault/05-Projects/rachel8-architecture.md`. Core patterns are valid (grammY webhook, BunQueue scheduling, shared folder structure) but the model/framework choices are outdated (referenced Mastra + Gemini, now using Claude Agent SDK + Claude Opus 4.6).
- **Infrastructure:** Hetzner VPS with full sudo. Syncthing already configured and syncing between VPS (`/data/shared/vault/`) and local machine (`~/RachelShared/vault/`).
- **Shared vault structure:** Obsidian-style folder hierarchy (00-Inbox, 01-Calendar, 02-Travel, 03-Notes, 04-Links, 05-Projects, 06-Archive). Rachel monitors Inbox and organizes files automatically.
- **Model access:** Claude Opus 4.6 via Anthropic Max subscription. Agent SDK: https://platform.claude.com/docs/en/agent-sdk/typescript
- **Runtime:** Bun (not Node). Deployed as long-running process on VPS.

## Constraints

- **Runtime:** Bun — all code must be Bun-compatible
- **Model:** Claude Opus 4.6 via Anthropic Agent SDK — no other AI frameworks
- **Telegram:** grammY in webhook mode — must work behind HTTPS on VPS
- **Persistence:** SQLite (via LibSQL) for conversation memory and queue storage — no external databases
- **Single process:** Everything runs in one Bun process (webhook server + queue workers)
- **Deployment:** Hetzner VPS — not serverless, not containerized (unless decided later)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude Agent SDK over Mastra | Anthropic's native SDK, direct integration with Claude Opus 4.6, simpler stack | — Pending |
| BunQueue for scheduling | Reliable cron/delayed jobs backed by SQLite, no external dependencies | — Pending |
| grammY for Telegram | Lightweight, well-maintained, good webhook support for Bun | — Pending |
| Text-only for v1 | Reduce scope, voice can be layered on later without architectural changes | — Pending |
| Single process architecture | Simplicity — webhook server and queue workers in same process | — Pending |

---
*Last updated: 2026-02-10 after initialization*
