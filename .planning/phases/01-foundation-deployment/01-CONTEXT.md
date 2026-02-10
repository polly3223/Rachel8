# Phase 1: Foundation & Deployment - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

VPS provisioning, project scaffolding with TypeScript/Bun, setup wizard for API keys and configuration, and systemd service for 24/7 operation with auto-restart. This phase delivers the infrastructure that makes Rachel run reliably — no Telegram, no AI, no scheduling yet.

</domain>

<decisions>
## Implementation Decisions

### Setup Wizard Flow
- Interactive CLI prompts (step-by-step, like npm init)
- All required API keys must be provided before wizard completes — block until valid
- Format-check only for API key validation (no live API calls during setup)
- Install via curl | bash one-liner that clones repo and launches wizard
- Wizard collects: Claude API key, Telegram bot token, Exa API key, shared folder path

### Project Structure
- Strict TypeScript (strict: true, no any, explicit types everywhere)
- All config in .env file only — no separate config files
- Testing with Bun's built-in test runner (bun test)
- Source organization: Claude's discretion

### Deployment Model
- Rachel lives at ~/rachel8 on VPS
- systemd service with auto-restart immediately on crash (with rate limiting to prevent loops)
- Install script assumes Bun is already installed — fail with clear message if missing
- Logging: Claude's discretion

### Dev Experience
- Local development, deploy to VPS via git pull
- CLI/mock mode for local testing without real Telegram bot
- Hot reload with bun --watch during local development

### Claude's Discretion
- Source code folder organization (feature folders vs layer folders vs hybrid)
- Logging strategy (journalctl only vs journalctl + log file)
- Loading skeleton / spinner design for wizard
- Exact systemd unit file configuration details

</decisions>

<specifics>
## Specific Ideas

- curl | bash install script should clone repo to ~/rachel8 and immediately launch the interactive wizard
- Wizard should give clear instructions for where to get each API key (links to Telegram BotFather, Anthropic console, Exa dashboard)
- Local CLI mode means typing messages in terminal instead of Telegram — for faster iteration during development

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-deployment*
*Context gathered: 2026-02-10*
