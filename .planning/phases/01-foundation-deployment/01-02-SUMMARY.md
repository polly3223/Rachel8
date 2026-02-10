---
phase: 01-foundation-deployment
plan: 02
subsystem: infra
tags: [clack-prompts, cli-wizard, systemd, api-validation, bun]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Bun project, Zod env schema, logger, directory structure"
provides:
  - "API key format validators for Claude, Telegram, Exa (src/setup/validate.ts)"
  - "Interactive setup wizard collecting all config (src/setup/wizard.ts)"
  - "systemd service installer with error handling (src/setup/install.ts)"
  - "rachel8.service template with exponential backoff and security hardening"
  - "Application entry point with config validation and graceful shutdown (src/index.ts)"
affects: [01-03, 02-telegram-bot, 03-agent-core]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Sequential @clack/prompts with isCancel checks for step-by-step wizard", "Placeholder-based systemd template (USER, WORKING_DIR, BUN_PATH)", "Format-only validators returning undefined|string for clack validate integration"]

key-files:
  created:
    - "src/setup/validate.ts"
    - "src/setup/validate.test.ts"
    - "src/setup/wizard.ts"
    - "src/setup/install.ts"
    - "rachel8.service"
  modified:
    - "src/index.ts"

key-decisions:
  - "Used sequential prompts with isCancel() instead of group() to show API key instructions between each prompt"
  - "Validators accept string|undefined to match clack/prompts validate signature"
  - "systemd service template uses placeholders replaced at install time rather than hardcoded paths"
  - "Entry point uses setInterval(60s) keepalive instead of Bun.serve() for simplicity"

patterns-established:
  - "Wizard pattern: sequential text() calls with log.info() instructions before each, isCancel() after each"
  - "Validator pattern: (value: string|undefined) => string|undefined -- undefined means valid, string is error message"
  - "Service template: rachel8.service with __PLACEHOLDER__ replaced by install.ts at runtime"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 1 Plan 2: Setup Wizard Summary

**Interactive CLI wizard with @clack/prompts, API key validators with 30 tests, systemd installer, and entry point with graceful shutdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T18:42:36Z
- **Completed:** 2026-02-10T18:46:19Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Created 4 format validators (Anthropic, Telegram, Exa, folder path) with 30 passing tests covering valid, empty, invalid, and edge cases
- Built step-by-step setup wizard that shows instructions before each API key prompt, auto-detects /data/shared/vault, and writes .env
- Created systemd service installer with template replacement, version detection, and manual install fallback
- Implemented Rachel entry point with Zod config validation, SIGTERM/SIGINT shutdown, and keepalive for systemd

## Task Commits

Each task was committed atomically:

1. **Task 1: Create API key validators with tests** - `8222e60` (feat)
2. **Task 2: Build interactive setup wizard and systemd installer** - `bdc8bfe` (feat)
3. **Task 3: Create Rachel entry point with config validation and graceful shutdown** - `3997fc5` (feat)

## Files Created/Modified
- `src/setup/validate.ts` - Format validators for Anthropic key, Telegram token, Exa key, and folder paths
- `src/setup/validate.test.ts` - 30 tests across 4 describe blocks (valid, empty, invalid, edge cases)
- `src/setup/wizard.ts` - Interactive setup wizard using @clack/prompts sequential text() calls
- `src/setup/install.ts` - systemd service installer with template replacement and error handling
- `rachel8.service` - systemd unit template with exponential backoff, rate limiting, and security hardening
- `src/index.ts` - Entry point with env validation, startup logging, graceful shutdown, and keepalive

## Decisions Made
- Used sequential prompts with `isCancel()` instead of `group()` because group() does not support showing instructional notes between prompts -- the plan called for step-by-step instructions like npm init
- Validators accept `string | undefined` to match the @clack/prompts `validate` function signature, which passes `undefined` when input is empty
- systemd service template uses `__USER__`, `__WORKING_DIR__`, `__BUN_PATH__` placeholders replaced at install time, making it portable across user accounts and install locations
- Entry point uses `setInterval(() => {}, 60_000)` as keepalive rather than `Bun.serve()` because there is no HTTP endpoint yet -- later phases will replace this with the grammY webhook server

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Telegram token test data too short**
- **Found during:** Task 1 (validator tests)
- **Issue:** Initial test token body was 31 characters but regex requires 35+
- **Fix:** Extended test token bodies to 36+ characters
- **Files modified:** src/setup/validate.test.ts
- **Verification:** All 30 tests pass
- **Committed in:** 8222e60 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial test data fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Setup wizard ready: `bun run setup` collects all config and writes .env
- Entry point ready: `bun run start` validates config and stays alive with graceful shutdown
- systemd service template ready for Plan 03 deployment
- All validators and wizard importable by future phases

## Self-Check: PASSED

All 5 created files and 1 modified file verified on disk. All 3 commit hashes (8222e60, bdc8bfe, 3997fc5) found in git log. All 30 tests pass. TypeScript strict mode clean.

---
*Phase: 01-foundation-deployment*
*Completed: 2026-02-10*
