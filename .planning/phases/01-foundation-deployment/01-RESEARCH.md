# Phase 1: Foundation & Deployment - Research

**Researched:** 2026-02-10
**Domain:** Project scaffolding (Bun/TypeScript), interactive CLI setup wizard, .env configuration, systemd service management
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Setup Wizard Flow
- Interactive CLI prompts (step-by-step, like npm init)
- All required API keys must be provided before wizard completes -- block until valid
- Format-check only for API key validation (no live API calls during setup)
- Install via curl | bash one-liner that clones repo and launches wizard
- Wizard collects: Claude API key, Telegram bot token, Exa API key, shared folder path

#### Project Structure
- Strict TypeScript (strict: true, no any, explicit types everywhere)
- All config in .env file only -- no separate config files
- Testing with Bun's built-in test runner (bun test)
- Source organization: Claude's discretion

#### Deployment Model
- Rachel lives at ~/rachel8 on VPS
- systemd service with auto-restart immediately on crash (with rate limiting to prevent loops)
- Install script assumes Bun is already installed -- fail with clear message if missing
- Logging: Claude's discretion

#### Dev Experience
- Local development, deploy to VPS via git pull
- CLI/mock mode for local testing without real Telegram bot
- Hot reload with bun --watch during local development

### Claude's Discretion
- Source code folder organization (feature folders vs layer folders vs hybrid)
- Logging strategy (journalctl only vs journalctl + log file)
- Loading skeleton / spinner design for wizard
- Exact systemd unit file configuration details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

Phase 1 delivers the foundation that all subsequent phases build on: a Bun/TypeScript project with strict typing, an interactive setup wizard that collects all required API keys and configuration, a .env file as the single configuration store, and a systemd service that keeps Rachel running 24/7 with auto-restart. No Telegram, no AI, no scheduling -- just the reliable infrastructure shell.

The research reveals a clean standard stack for this phase. Bun v1.3.9 provides native TypeScript execution, built-in .env loading, and a Jest-compatible test runner. The `@clack/prompts` library (v1.0.0) is the clear winner for the interactive setup wizard -- it works natively with Bun (unlike Inquirer which has known compatibility issues), provides beautiful CLI output, and includes all needed components (text, password, select, confirm, spinner, group). For logging, a lightweight approach using `console.log` with a thin structured wrapper is recommended over pino, which has documented compatibility problems with Bun's worker thread handling. systemd provides all the restart and rate-limiting features needed natively, including exponential backoff via `RestartSteps` and `RestartMaxDelaySec` (available since systemd 254).

**Primary recommendation:** Use @clack/prompts for the wizard, Zod for .env validation, Bun.write() to generate the .env file, and a layer-first source organization that maps cleanly to later phases.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | v1.3.9 | Runtime, package manager, test runner | Native TypeScript, built-in .env loading, built-in test runner, 3x faster than Node.js |
| TypeScript | (bundled with Bun) | Type safety | Bun executes .ts natively; strict mode enforced via tsconfig.json |
| @clack/prompts | v1.0.0 | Interactive CLI wizard | Works natively with Bun (Inquirer has known issues), beautiful UI, group/spinner/validation built-in, 5.3KB, zero-config |
| zod | latest | Runtime validation | Validates .env schema at startup, generates TypeScript types, used later by Agent SDK for tool definitions |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/bun | latest (dev) | Bun type definitions | Required for IDE support and type checking of Bun APIs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @clack/prompts | Inquirer.js (@inquirer/prompts) | Inquirer is more feature-rich but has known Bun compatibility issues: Ctrl+C doesn't exit properly, arrow keys can stop working. Use only if Clack proves insufficient. |
| @clack/prompts | bun-promptx | Bun-native but much smaller community, fewer features, less maintained. |
| @clack/prompts | prompts (npm) | Lightweight but less beautiful output, no built-in spinner or group functionality. |
| console.log wrapper | pino | Pino is industry standard but has documented compatibility issues with Bun (worker thread transport resolution fails). Requires bun-plugin-pino workaround. Overkill for Phase 1. |
| console.log wrapper | LogTape | Zero dependencies, 5.3KB, works with Bun. Good candidate if structured logging needs grow beyond Phase 1. |
| console.log wrapper | winston | 38.3KB, 17 dependencies, slower. No advantage for this use case. |

**Installation:**
```bash
bun add @clack/prompts zod
bun add -D @types/bun
```

## Architecture Patterns

### Recommended Project Structure

**Recommendation (Claude's Discretion): Layer-first organization.**

Rationale: Phase 1 has minimal code. Layer-first maps naturally to later phases where telegram/, agent/, scheduler/, vault/ become distinct layers. Feature folders would create premature fragmentation. A hybrid approach (layer-first at top, feature grouping within layers) provides the best balance.

```
rachel8/
├── src/
│   ├── index.ts              # Entry point — starts Rachel
│   ├── config/
│   │   └── env.ts            # Zod schema, .env validation, typed config export
│   ├── setup/
│   │   ├── wizard.ts         # Interactive setup wizard (clack prompts)
│   │   ├── install.ts        # systemd service installation
│   │   └── validate.ts       # API key format validators
│   ├── cli/
│   │   └── mock.ts           # CLI/mock mode for local development
│   └── lib/
│       └── logger.ts         # Thin logging wrapper
├── scripts/
│   └── install.sh            # curl | bash one-liner entry point
├── rachel8.service            # systemd unit file template
├── tsconfig.json
├── package.json
├── .env.example               # Template showing required vars
├── .gitignore
└── README.md
```

**Structure rationale:**
- `config/` -- Centralized configuration with Zod validation. Single source of truth for all env vars.
- `setup/` -- Everything related to first-run setup. Wizard, systemd installation, validators.
- `cli/` -- Mock mode for local development. Later phases add CLI commands here.
- `lib/` -- Shared utilities (logger, etc.). Grows as needed.
- `scripts/` -- Shell scripts (install.sh). Not TypeScript, not in src/.
- Root-level `rachel8.service` -- systemd unit template, copied during setup.

### Pattern 1: Zod Environment Validation at Startup

**What:** Parse and validate all environment variables through a Zod schema before any code runs. Fail fast with actionable error messages.

**When to use:** Always. This is the first thing `index.ts` does.

**Example:**
```typescript
// src/config/env.ts
import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{35,}$/),
  EXA_API_KEY: z.string().min(1),
  SHARED_FOLDER_PATH: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Bun loads .env automatically — no dotenv needed
  const result = envSchema.safeParse(Bun.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nRun the setup wizard: bun run src/setup/wizard.ts");
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
```

### Pattern 2: Clack Group Wizard Flow

**What:** Use @clack/prompts group() to collect all configuration in a single cancelable flow, with validation on each field.

**When to use:** First-run setup or reconfiguration.

**Example:**
```typescript
// src/setup/wizard.ts
import { intro, outro, text, confirm, spinner, group, cancel, isCancel, note } from "@clack/prompts";
import { validateAnthropicKey, validateTelegramToken, validateExaKey } from "./validate";

intro("Rachel8 Setup");

const config = await group(
  {
    anthropicKey: () =>
      text({
        message: "Claude API key",
        placeholder: "sk-ant-api03-...",
        validate: validateAnthropicKey,
      }),
    telegramToken: () =>
      text({
        message: "Telegram bot token",
        placeholder: "123456789:ABC...",
        validate: validateTelegramToken,
      }),
    exaKey: () =>
      text({
        message: "Exa API key",
        validate: validateExaKey,
      }),
    sharedFolder: () =>
      text({
        message: "Shared folder path",
        initialValue: "/data/shared/vault",
        validate: (v) => {
          if (!v) return "Path is required";
        },
      }),
  },
  {
    onCancel: () => {
      cancel("Setup cancelled.");
      process.exit(0);
    },
  }
);

// Write .env file
const envContent = [
  `ANTHROPIC_API_KEY=${config.anthropicKey}`,
  `TELEGRAM_BOT_TOKEN=${config.telegramToken}`,
  `EXA_API_KEY=${config.exaKey}`,
  `SHARED_FOLDER_PATH=${config.sharedFolder}`,
  `NODE_ENV=production`,
  `LOG_LEVEL=info`,
].join("\n");

await Bun.write(".env", envContent + "\n");

outro("Rachel8 is configured! Run: sudo systemctl start rachel8");
```

### Pattern 3: Install Script with Prerequisite Checks

**What:** A bash script that validates prerequisites, clones the repo, installs dependencies, and launches the wizard.

**When to use:** First-time installation on VPS.

**Example:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Prerequisites ---
command -v bun >/dev/null 2>&1 || {
  echo "Error: Bun is not installed."
  echo "Install it first: curl -fsSL https://bun.sh/install | bash"
  exit 1
}

command -v git >/dev/null 2>&1 || {
  echo "Error: git is not installed."
  echo "Install it first: sudo apt install git"
  exit 1
}

INSTALL_DIR="$HOME/rachel8"

if [ -d "$INSTALL_DIR" ]; then
  echo "Error: $INSTALL_DIR already exists."
  echo "To reinstall, remove it first: rm -rf $INSTALL_DIR"
  exit 1
fi

# --- Clone and setup ---
echo "Cloning Rachel8..."
git clone https://github.com/USER/rachel8.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "Installing dependencies..."
bun install

echo "Launching setup wizard..."
bun run src/setup/wizard.ts
```

### Pattern 4: systemd Service with Rate-Limited Restart

**What:** systemd unit file with Restart=always, exponential backoff via RestartSteps, and security hardening.

**When to use:** Production deployment on VPS.

**Example:**
```ini
# rachel8.service
[Unit]
Description=Rachel8 Personal AI Assistant
After=network.target

[Service]
Type=simple
User=lory
WorkingDirectory=/home/lory/rachel8
ExecStart=/home/lory/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=5s
RestartSteps=5
RestartMaxDelaySec=60s

# Rate limiting: max 5 restarts in 300s window
StartLimitIntervalSec=300
StartLimitBurst=5

# Graceful shutdown
TimeoutStopSec=10
KillMode=mixed
KillSignal=SIGTERM

# Environment
Environment="NODE_ENV=production"

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

# Logging: stdout/stderr go to journalctl
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rachel8

[Install]
WantedBy=multi-user.target
```

### Anti-Patterns to Avoid

- **Using dotenv package:** Bun loads .env files automatically. Adding dotenv is unnecessary bloat and can conflict with Bun's native loading.
- **Inquirer.js with Bun:** Known compatibility issues (Ctrl+C, arrow keys). Use @clack/prompts instead.
- **PM2 for process management:** Extra layer of complexity when systemd handles everything needed (restart, logging, boot start). systemd is simpler and more reliable for single-process VPS deployment.
- **Separate config files (YAML, JSON, TOML):** User decided all config in .env only. No config/ directory with multiple files.
- **pino with Bun (Phase 1):** Worker thread transport resolution issues. For Phase 1's needs, a thin console wrapper suffices. Revisit if structured logging needs grow.
- **Running setup wizard as root:** Wizard and Rachel should run as the regular user. Only systemd service installation needs sudo.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive CLI prompts | Custom readline/stdin handling | @clack/prompts | Terminal compatibility, cursor management, color, validation -- surprisingly complex to get right |
| .env file parsing | Custom KEY=VALUE parser | Bun's built-in .env loading | Handles quotes, escapes, multiline, comments, expansion. Edge cases are numerous. |
| Environment validation | Manual if/else checks | Zod schema + safeParse | Type inference, structured errors, composable, reused across project |
| Process management | Custom restart scripts, cron watchdog | systemd | Handles restart, rate limiting, boot start, logging, security hardening. Battle-tested. |
| Signal handling | Custom process.kill management | process.on("SIGTERM"/SIGINT") | Bun supports standard signal handlers. Just register cleanup and call process.exit(). |
| API key format checking | Freeform string matching | Regex patterns per provider | Well-documented formats exist. Regex catches typos without network calls. |

**Key insight:** Phase 1 is infrastructure glue. Every component has a mature, well-tested solution. The value is in correct integration, not custom implementation.

## Common Pitfalls

### Pitfall 1: .env File Not Found on First Run

**What goes wrong:** Application crashes on first run because .env doesn't exist yet. Zod parse fails with cryptic errors.

**Why it happens:** Bun silently skips missing .env files (no error). But the Zod validation fires and fails because required variables are undefined.

**How to avoid:** Detect whether .env exists before attempting validation. If missing, print friendly message directing user to run the setup wizard. Never let Zod errors be the first thing a new user sees.

**Warning signs:** Error output showing Zod validation failures with "Required" messages for every field.

### Pitfall 2: systemd Rate Limiting Kills Service Permanently

**What goes wrong:** After a bug causing rapid crashes, systemd stops restarting the service. It stays down until manual `systemctl reset-failed rachel8 && systemctl start rachel8`.

**Why it happens:** Default StartLimitBurst is 5 in 10 seconds. If RestartSec is too low (e.g., 0s or 1s), 5 crashes burn through the limit instantly. Service enters "failed" state and never restarts.

**How to avoid:** Use RestartSec=5s minimum to space out restarts. Set StartLimitIntervalSec=300 with StartLimitBurst=5 (5 restarts in 5 minutes). Use RestartSteps=5 with RestartMaxDelaySec=60s for exponential backoff. This gives the service time to recover from transient issues.

**Warning signs:** `systemctl status rachel8` shows "start request repeated too quickly" or "start-limit-hit".

### Pitfall 3: curl | bash Partial Download Execution

**What goes wrong:** Network interruption during `curl | bash` causes a partially downloaded script to execute, potentially running incomplete commands.

**Why it happens:** Bash executes lines as they arrive from curl. If the connection drops mid-script, bash runs whatever it has -- which could be a truncated command.

**How to avoid:** Wrap the entire install script body in a function and call it at the end: `main() { ... }; main "$@"`. Bash won't execute `main` until the entire script is downloaded. Use `set -euo pipefail` at the top to abort on any error.

**Warning signs:** Install appears to "partially complete" with missing files or directories.

### Pitfall 4: Bun.env vs process.env Type Confusion

**What goes wrong:** Code uses `Bun.env.SOME_VAR` expecting a typed value but gets `string | undefined`. Or mixes Bun.env and process.env causing inconsistency.

**Why it happens:** `Bun.env` is a simple alias for `process.env`. All values are strings or undefined. There is no built-in type narrowing.

**How to avoid:** Always access environment through the validated Zod config object (`env.ANTHROPIC_API_KEY`), never directly through `Bun.env` or `process.env` in application code. The config module is the single source of truth.

**Warning signs:** TypeScript errors about `string | undefined` where you expected `string`.

### Pitfall 5: Wizard Collects Config but Doesn't Verify Paths Exist

**What goes wrong:** User enters a shared folder path that doesn't exist. Rachel starts successfully but crashes later when trying to access it.

**Why it happens:** Format validation passes (non-empty string) but no filesystem check is performed during setup.

**How to avoid:** In the wizard, after collecting the shared folder path, verify it exists with `Bun.file(path).exists()` or equivalent. If it doesn't exist, ask the user if they want to create it or enter a different path. For the `/data/shared/vault` auto-detection on VPS, check existence before suggesting it as the default.

**Warning signs:** Runtime errors about "ENOENT: no such file or directory" for the shared vault path.

### Pitfall 6: systemd Service Runs Before .env Exists

**What goes wrong:** systemd starts rachel8 on boot, but .env hasn't been created yet (fresh install, or .env was accidentally deleted). Service enters crash loop.

**Why it happens:** systemd starts the service on boot via WantedBy=multi-user.target. It doesn't know about .env dependencies.

**How to avoid:** In index.ts, check for .env existence before Zod validation. If missing, log a clear message and exit with code 0 (not 1) so systemd treats it as a clean exit, not a failure requiring restart. Alternatively, use `ConditionPathExists=/home/lory/rachel8/.env` in the systemd unit file.

**Warning signs:** journalctl shows rapid start-stop cycles with "missing configuration" messages.

## Code Examples

Verified patterns from official sources:

### Bun tsconfig.json (from bun init)

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    /* Linting - strict mode */
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    /* Additional strict flags (user requested) */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```
Source: [Bun TypeScript docs](https://bun.com/docs/typescript)

### Bun.write() for Creating .env File

```typescript
// Bun.write returns number of bytes written
const bytes = await Bun.write(
  "/home/lory/rachel8/.env",
  "ANTHROPIC_API_KEY=sk-ant-api03-...\nTELEGRAM_BOT_TOKEN=123:ABC...\n"
);
```
Source: [Bun File I/O docs](https://bun.com/docs/runtime/file-io)

### Bun Graceful Shutdown

```typescript
// src/index.ts
function shutdown() {
  console.log("Shutting down gracefully...");
  // Close database connections, flush queues, etc.
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```
Source: [Bun signal handling](https://bun.sh/guides/process/os-signals)

### @clack/prompts Spinner for Long Operations

```typescript
import { spinner } from "@clack/prompts";

const s = spinner();
s.start("Installing systemd service...");
// Do the work
await installSystemdService();
s.stop("systemd service installed");
```
Source: [@clack/prompts README](https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md)

### @clack/prompts Cancel Handling

```typescript
import { text, isCancel, cancel } from "@clack/prompts";

const value = await text({ message: "Enter API key:" });
if (isCancel(value)) {
  cancel("Setup cancelled.");
  process.exit(0);
}
```
Source: [@clack/prompts README](https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md)

### Bun Test Runner

```typescript
// src/setup/validate.test.ts
import { describe, test, expect } from "bun:test";
import { validateAnthropicKey, validateTelegramToken } from "./validate";

describe("API key validation", () => {
  test("accepts valid Anthropic key format", () => {
    expect(validateAnthropicKey("sk-ant-api03-abc123")).toBeUndefined();
  });

  test("rejects invalid Anthropic key format", () => {
    expect(validateAnthropicKey("invalid")).toBe("Must start with sk-ant-");
  });

  test("accepts valid Telegram token format", () => {
    expect(validateTelegramToken("123456789:ABCdefGHI_jklMNOpqr-stuvwxyz12345")).toBeUndefined();
  });

  test("rejects invalid Telegram token format", () => {
    expect(validateTelegramToken("not-a-token")).toBe("Invalid token format. Expected: 123456789:ABC...");
  });
});
```
Source: [Bun test runner docs](https://bun.com/docs/test)

### systemd Service Management Commands

```bash
# Install and enable
sudo cp rachel8.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable rachel8
sudo systemctl start rachel8

# Monitor
sudo systemctl status rachel8
sudo journalctl -u rachel8 -f           # Follow logs
sudo journalctl -u rachel8 --since today # Today's logs
sudo journalctl -u rachel8 -n 100       # Last 100 lines

# Restart / stop
sudo systemctl restart rachel8
sudo systemctl stop rachel8

# After crash loop, reset and restart
sudo systemctl reset-failed rachel8
sudo systemctl start rachel8
```
Source: [Bun systemd guide](https://bun.com/docs/guides/ecosystem/systemd)

## Discretion Recommendations

### Source Code Organization

**Recommendation: Layer-first with setup/ as a dedicated layer.**

The project structure above uses layer-first organization. Rationale:
1. Phase 1 has only two functional areas (setup and config). Feature folders would be premature.
2. Later phases add telegram/, agent/, scheduler/, vault/ as distinct layers -- this maps naturally.
3. Layer-first makes the architecture visible to new readers (and to future Claude sessions).
4. Within each layer, files can be grouped by sub-feature if they grow large enough.

### Logging Strategy

**Recommendation: journalctl only, with a thin console.log wrapper.**

Rationale:
1. **pino has Bun compatibility issues.** Worker thread transport resolution fails with Bun. Requires bun-plugin-pino workaround. Not worth the complexity for Phase 1.
2. **journalctl captures stdout/stderr automatically** when running as a systemd service. No special configuration needed.
3. **A thin wrapper** provides log levels (debug/info/warn/error), timestamps, and structured context without external dependencies.
4. **Upgrade path:** If structured JSON logging becomes necessary in later phases, LogTape (zero dependencies, 5.3KB, native Bun support, 225ns/log) is the recommended upgrade. It can replace the thin wrapper without changing call sites if the wrapper uses the same log level API.

Example thin wrapper:
```typescript
// src/lib/logger.ts
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = (Bun.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => {
    if (shouldLog("debug")) console.debug(`[DEBUG] ${msg}`, ctx ?? "");
  },
  info: (msg: string, ctx?: Record<string, unknown>) => {
    if (shouldLog("info")) console.log(`[INFO] ${msg}`, ctx ?? "");
  },
  warn: (msg: string, ctx?: Record<string, unknown>) => {
    if (shouldLog("warn")) console.warn(`[WARN] ${msg}`, ctx ?? "");
  },
  error: (msg: string, ctx?: Record<string, unknown>) => {
    if (shouldLog("error")) console.error(`[ERROR] ${msg}`, ctx ?? "");
  },
};
```

### Wizard Spinner Design

**Recommendation: Use @clack/prompts spinner and tasks for multi-step operations.**

The wizard has two phases: collecting input (group) and performing setup (tasks). Use spinner for single operations and tasks() for the multi-step installation sequence:

```typescript
import { tasks } from "@clack/prompts";

await tasks([
  {
    title: "Writing configuration...",
    task: async () => {
      await Bun.write(".env", envContent);
      return "Configuration saved to .env";
    },
  },
  {
    title: "Installing systemd service...",
    task: async () => {
      // Copy service file, enable, start
      return "Service installed and started";
    },
  },
]);
```

### systemd Unit File Configuration

**Recommendation: Use the configuration in Pattern 4 above.** Key design choices:
- `Restart=always` (not `on-failure`) because Rachel should always be running
- `RestartSec=5s` with `RestartSteps=5` / `RestartMaxDelaySec=60s` for exponential backoff (5s, 15s, 30s, 45s, 60s)
- `StartLimitIntervalSec=300` / `StartLimitBurst=5` to prevent infinite restart loops
- `ConditionPathExists=/home/lory/rachel8/.env` to prevent crash loops when config is missing
- Minimal security hardening (`NoNewPrivileges`, `PrivateTmp`) without `ProtectHome` (Rachel needs access to ~/rachel8 and shared vault)
- `StandardOutput=journal` + `SyslogIdentifier=rachel8` for clean journalctl filtering

## API Key Format Validation

Format-check patterns (no live API calls, per user decision):

| Key | Format | Validation Regex | Notes |
|-----|--------|-----------------|-------|
| Claude API key | `sk-ant-api03-...` | `/^sk-ant-api03-[a-zA-Z0-9_-]+$/` | Prefix is well-documented. Alphanumeric + underscore + hyphen in body. |
| Telegram bot token | `123456789:ABCdef...` | `/^\d{8,}:[A-Za-z0-9_-]{35,}$/` | Numeric bot ID, colon, 35+ alphanumeric chars. Regex from GitGuardian. |
| Exa API key | (no documented prefix) | `/^.{10,}$/` | Exa does not document a specific format. Check non-empty and minimum length only. |

Sources: [GitGuardian Claude detector](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/claude_api_key), [GitGuardian Telegram detector](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/telegrambot_bot_token)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| dotenv package for .env loading | Bun loads .env automatically | Bun 1.0+ (2023) | No dotenv dependency needed |
| PM2 for process management | systemd native | Long-standing, but adoption growing | Simpler, more reliable, fewer dependencies |
| Jest for testing | Bun built-in test runner | Bun 1.0+ (2023) | 10-50x faster, no configuration needed |
| Manual RestartSec escalation | systemd RestartSteps + RestartMaxDelaySec | systemd 254 (July 2023) | Native exponential backoff without workarounds |
| Inquirer.js for CLI prompts | @clack/prompts | Clack 1.0.0 (2025) | Better Bun compatibility, smaller, more beautiful |
| pino for logging everywhere | Lightweight alternatives for Bun | 2025-2026 | pino worker thread issues with Bun; LogTape or console wrappers preferred |

**Deprecated/outdated:**
- **dotenv package with Bun:** Unnecessary. Bun handles this natively. Can actually conflict with Bun's loading.
- **ts-node:** Bun executes TypeScript directly. No transpilation step needed.
- **jest:** Bun's built-in test runner is Jest-compatible but 10-50x faster.

## Open Questions

1. **Exa API key format**
   - What we know: Keys are obtained from dashboard.exa.ai/api-keys. No documented prefix pattern.
   - What's unclear: Whether Exa keys follow a specific format (like `exa-...` or similar).
   - Recommendation: Use minimal validation (non-empty, minimum length 10). Can be tightened later when format is confirmed during Phase 3 implementation.

2. **systemd version on target VPS**
   - What we know: RestartSteps/RestartMaxDelaySec require systemd 254+ (July 2023). Most current distros include 254+.
   - What's unclear: What systemd version is on the Hetzner VPS.
   - Recommendation: Check with `systemctl --version` during install. If < 254, fall back to fixed RestartSec=10s without exponential backoff. Add a version check in the install script.

3. **GitHub repo URL for clone**
   - What we know: Install script needs to clone the repo. curl | bash one-liner needs a raw script URL.
   - What's unclear: The actual GitHub repository URL (USER/rachel8).
   - Recommendation: Use placeholder in install script. Set actual URL when repo is created.

## Sources

### Primary (HIGH confidence)
- [Bun TypeScript docs](https://bun.com/docs/typescript) -- tsconfig.json configuration, strict mode
- [Bun Environment Variables docs](https://bun.com/docs/runtime/environment-variables) -- .env loading, Bun.env, file order
- [Bun File I/O docs](https://bun.com/docs/runtime/file-io) -- Bun.write() API
- [Bun systemd guide](https://bun.com/docs/guides/ecosystem/systemd) -- Service unit file template
- [Bun test runner docs](https://bun.com/docs/test) -- Built-in test runner API
- [Bun signal handling guide](https://bun.sh/guides/process/os-signals) -- SIGTERM/SIGINT handling
- [@clack/prompts README](https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md) -- Full API: text, select, confirm, spinner, group, tasks
- [@clack/prompts npm](https://www.npmjs.com/package/@clack/prompts) -- v1.0.0, 3667 dependents
- [systemd.service man page](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) -- Restart, StartLimit, RestartSteps
- [Zod docs](https://zod.dev/) -- Schema validation, safeParse, type inference

### Secondary (MEDIUM confidence)
- [GitGuardian Claude API key detector](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/claude_api_key) -- Key format: sk-ant-api03-
- [GitGuardian Telegram bot token detector](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/telegrambot_bot_token) -- Token format: digits:alphanum
- [systemd exponential restart explained](https://enotty.pipebreaker.pl/posts/2024/01/how-systemd-exponential-restart-delay-works/) -- RestartSteps/RestartMaxDelaySec behavior
- [systemd indefinite restarts](https://michael.stapelberg.ch/posts/2024-01-17-systemd-indefinite-service-restarts/) -- StartLimit configuration patterns
- [LogTape comparison](https://logtape.org/comparison) -- Performance benchmarks vs pino vs winston
- [LogTape GitHub](https://github.com/dahlia/logtape) -- Zero dependency, Bun/Deno/Node support
- [Clack + Bun tutorial](https://medium.com/@wangminder/a-simple-but-powerful-cli-demo-using-clack-with-ts-and-bun-cec91deeb95d) -- Working example
- [Bun production deployment](https://oneuptime.com/blog/post/2026-01-31-bun-production-deployment/view) -- Production best practices

### Tertiary (LOW confidence, needs validation)
- [Inquirer Bun compatibility issue](https://github.com/oven-sh/bun/issues/6592) -- Ctrl+C and arrow key issues (may be fixed in newer Bun versions)
- [pino Bun compatibility issues](https://github.com/oven-sh/bun/issues/23062) -- Transport resolution failures (may be fixed in newer versions)
- [bun-plugin-pino](https://github.com/vktrl/bun-plugin-pino) -- Workaround for pino transport issues (verify if still needed)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Bun docs are authoritative; @clack/prompts verified at v1.0.0; Zod is industry standard
- Architecture: HIGH -- Layer-first is well-established; systemd patterns extensively documented
- Pitfalls: HIGH -- All pitfalls verified against official docs or confirmed bug reports
- Discretion recommendations: MEDIUM -- Logging and organization are opinionated choices; alternatives exist

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable domain, 30-day validity)
