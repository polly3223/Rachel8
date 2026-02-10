---
phase: 01-foundation-deployment
plan: 03
subsystem: infra
tags: [bash, systemd, curl-installer, readme, deployment]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Bun project, package.json with scripts, directory structure"
  - phase: 01-02
    provides: "Setup wizard (wizard.ts), systemd installer (install.ts), rachel8.service template"
provides:
  - "curl | bash install script with prerequisite checks (scripts/install.sh)"
  - "systemd service template with ConditionPathExists guard and template comment"
  - "Complete README with VPS setup, API key instructions, and service management"
affects: [02-telegram-bot, 03-agent-core]

# Tech tracking
tech-stack:
  added: []
  patterns: ["main() wrapper for curl|bash safety", "Placeholder-based systemd template with install-time substitution"]

key-files:
  created:
    - "scripts/install.sh"
  modified:
    - "rachel8.service"
    - "README.md"

key-decisions:
  - "Kept __PLACEHOLDER__ system in rachel8.service rather than hardcoded lory paths, to avoid breaking install.ts replaceAll() from Plan 02"
  - "Used OWNER placeholder for GitHub repo URL in install script and README (actual URL set when repo is created)"

patterns-established:
  - "Install script uses main() wrapper to prevent partial-download execution during curl|bash"
  - "README follows concise practical format: quick start, from-zero VPS guide, API key acquisition, dev commands, service management"

# Metrics
duration: 2min
completed: 2026-02-10
---

# Phase 1 Plan 3: Deployment & README Summary

**curl|bash install script with prerequisite checks, systemd service template with ConditionPathExists, and comprehensive VPS setup README**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-10T18:48:52Z
- **Completed:** 2026-02-10T18:51:04Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created install script with main() wrapper for curl|bash safety, bun/git prerequisite checks, and automated clone-install-wizard flow
- Updated systemd service template with template comment header and ConditionPathExists guard
- Wrote comprehensive README covering VPS setup from zero, API key acquisition for all three services, development commands, and systemd service management

## Task Commits

Each task was committed atomically:

1. **Task 1: Create install script and systemd service template** - `30cacb9` (feat)
2. **Task 2: Write README with complete VPS setup instructions** - `519b84b` (feat)

## Files Created/Modified
- `scripts/install.sh` - curl|bash installer with main() wrapper, prerequisite checks (bun, git), clone + bun install + wizard launch
- `rachel8.service` - systemd unit template with template comment, ConditionPathExists, exponential backoff, rate limiting, security hardening
- `README.md` - Complete documentation: quick start one-liner, 8-step VPS setup, API key instructions for Claude/Telegram/Exa, dev commands, service management, project structure

## Decisions Made
- Kept `__USER__`, `__WORKING_DIR__`, `__BUN_PATH__` placeholder system in rachel8.service rather than switching to hardcoded `lory` values. The plan initially called for concrete values but `install.ts` from Plan 02 already does `replaceAll("__USER__", user)`. Switching to hardcoded values would silently break the replacement logic (Rule 1 - avoiding a bug).
- Used `OWNER` as GitHub username placeholder in install script and README. The actual URL will be set when the repository is created (open question from research).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept placeholder-based systemd template instead of hardcoded values**
- **Found during:** Task 1 (rachel8.service update)
- **Issue:** Plan instructed using concrete `lory` values with comment that install.ts substitutes them. However, install.ts from Plan 02 uses `replaceAll("__USER__", user)` -- switching to hardcoded values would make the replacement silently match nothing.
- **Fix:** Kept `__PLACEHOLDER__` system, added template comment as plan requested
- **Files modified:** rachel8.service
- **Verification:** install.ts placeholder replacement logic remains compatible
- **Committed in:** 30cacb9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug prevention)
**Impact on plan:** Preserved compatibility with existing install.ts. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 foundation complete: project scaffolding, setup wizard, systemd service, install script, and README all in place
- A user can follow the README from fresh VPS to running Rachel8
- Ready for Phase 2 (Telegram bot integration) with all infrastructure in place
- GitHub repo URL placeholder (OWNER) needs to be replaced when repo is published

## Self-Check: PASSED

All 3 files verified on disk (scripts/install.sh, rachel8.service, README.md). Both commit hashes (30cacb9, 519b84b) found in git log.

---
*Phase: 01-foundation-deployment*
*Completed: 2026-02-10*
