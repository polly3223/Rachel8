# Rachel

Personal AI assistant on Telegram, powered by Claude Code or Codex. Runs 24/7 on your server — builds landing pages, tracks leads, manages contacts, creates documents, schedules tasks, does research, and more. All from a simple Telegram message.

Rachel supports both the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) and the [bundled Codex stdio app-server](https://developers.openai.com/codex/app-server/). Choose the provider with `AI_PROVIDER=claudecode` or `AI_PROVIDER=codex` in `.env`. The default is `codex`.

You need exactly one provider CLI installed on the server:
- `claudecode` needs Claude Code installed and logged in
- `codex` needs Codex installed and logged in

## What can she do?

- Build and host landing pages, track form submissions
- Send you lead data as Excel, CSV, or any format
- Manage contacts, follow-ups, and reminders
- Create documents, proposals, presentations on demand
- Research anything — suppliers, competitors, market data
- Schedule tasks, set reminders, handle your admin work
- Read any file you send: PDFs, images, audio, video
- Run code, manage servers, deploy projects
- Remember everything — persistent memory across all conversations

She's not a chatbot. She's a full AI agent with tools, running on your own server.

## Setup

`bun run setup` writes `.env` and is the setup flow.

All commands below assume a fresh Ubuntu server. Run everything in order.

### 1. Create the `rachel` user (as root)

SSH in as root, then create a dedicated user. Rachel runs as a regular Linux user — no sudo needed.

```bash
adduser rachel --ingroup users --disabled-password
```

Press Enter through the Full Name / Room / Phone prompts. Then switch to the new user:

```bash
su - rachel
```

**All remaining steps run as `rachel`.**

### 2. Install system dependencies and Bun

```bash
sudo apt update && sudo apt install -y unzip gh
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 3. Log in to GitHub

```bash
gh auth login
```

### 4. Install one provider CLI

Pick one.

For `AI_PROVIDER=claudecode`:

On Linux/server environments:

```bash
curl -fsSL https://claude.ai/install.sh | bash
source ~/.bashrc
```

On macOS with Homebrew-managed Node:

```bash
brew install node
bun add --global @anthropic-ai/claude-code
```

For `AI_PROVIDER=codex`:

On Linux/server environments:

Rachel can use the bundled Codex CLI after `bun install`, so there is nothing extra to install in this step.

On macOS with Homebrew:

```bash
brew install --cask codex
```

Both setups work the same once the chosen CLI is installed and logged in, so a Linux VPS and a Mac mini server follow the same Rachel flow after this step.

### Provider CLI path notes

Rachel needs to be able to find the selected provider CLI from both your shell and the `systemd --user` service.

- Rachel automatically checks common install locations, including `~/.local/bin`, `~/.bun/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, and `/home/linuxbrew/.linuxbrew/bin`
- This covers typical Homebrew/Linuxbrew installs of both Codex and Claude Code
- `systemd --user` may not inherit the same `PATH` as your interactive shell, so a CLI that works in your terminal can still fail when Rachel runs as a service

### 5. Clone and install

```bash
gh repo clone <your-username>/rachel8 ~/rachel8
cd ~/rachel8
bun install
```

### 6. Log in to your chosen provider CLI

For `AI_PROVIDER=claudecode`:

```bash
claude login
claude -p 'say hello'
```

For `AI_PROVIDER=codex`:

```bash
bun x codex login
codex login status
```

Rachel expects the selected CLI to already be logged in on the server. There are no provider-specific auth settings in `.env`.

### 7. Run the setup wizard

```bash
bun run setup
```

The wizard will ask for:
- **Telegram bot token** — create one via [@BotFather](https://t.me/BotFather) (`/newbot`)
- **Your Telegram user ID** — send `/start` to [@userinfobot](https://t.me/userinfobot)
- **AI provider** — `claudecode` or `codex`
- **Shared folder path** — where Rachel stores memory, files, and data
- **systemd service** — optionally installs Rachel as a background service

### 8. Start Rachel

If you installed the systemd service (recommended):

```bash
systemctl --user start rachel8
systemctl --user status rachel8
```

Or run manually:

```bash
cd ~/rachel8
bun run start
```

That's it. Send a message to your bot on Telegram.

## Before you start: create your Telegram bot

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Choose a name (e.g., "Rachel")
4. Choose a username (e.g., "my_rachel_bot")
5. Copy the token — you'll paste it into the setup wizard

## Development

```bash
bun run dev          # Start with hot reload (bun --watch)
bun run start        # Start normally
bun run setup        # Re-run setup wizard
bun run check        # Strict TypeScript, isolated tests and build
```

## Remote Re-Login

If the selected CLI session expires, Rachel will tell you on Telegram and ask you to run `/login`.

- `/login` starts the login flow for the configured provider
- `/login_status` shows whether `claudecode` or `codex` is currently logged in
- `/login_code <code>` sends a one-time code back to the CLI if the provider asks for it
- `/login_cancel` aborts an in-progress login flow

## Slack and Linear connectors

When Codex is the selected provider, Rachel can install and authenticate its official Slack and
Linear plugins entirely through Telegram:

- `/connector_connect linear` installs Linear and sends its OAuth link
- `/connector_connect slack` installs Slack and verifies access with a read-only probe
- `/connector_status [linear|slack]` reports installation and authentication state
- `/connector_cancel` aborts an active connector login

Linear's OAuth callback targets the VPS-local Codex listener. If the browser cannot open the final
localhost page, send its complete address-bar URL with `/connector_callback <url>` and Rachel will
relay it to the validated local callback. Connector access still follows the permissions configured
in the connected Slack or Linear account.

## Work controls and recovery

AI replies and progress messages use Telegram's [native Rich Messages](https://core.telegram.org/bots/api#rich-message-formatting-options), including Markdown tables, headings, lists, quotes, code and formulas. Long replies split at paragraph boundaries where possible within the 32,768-character limit. Rejected formatting falls back to an unformatted rich paragraph, preserving one delivery receipt per message. Login links remain plain text.

Messages are saved before Telegram intake returns. While a Codex turn runs, a new text message can steer it; `/stop` and `/status` stay responsive. Albums are grouped, quoted replies retain their context, and pictures are passed as native image inputs. `/answer <text>` answers a pending provider question.

Scheduled work and owner messages share a small SQLite queue in `rachel-memory/tasks.db`. Runs preserve status, conversation IDs, checkpoints and delivery progress. `/resume <work ID>` explicitly recovers interrupted work after inspecting completed effects; it does not blindly replay actions on startup. `/retry_delivery <work ID>` retries only a saved result. Delivery is at-least-once: a network failure after Telegram accepts a message can still produce a duplicate. Failed deliveries stop after six attempts and remain visible.

New cron schedules default to Europe/Rome; legacy schedules retain UTC. Use `bun run schedule` or the typed Rachel task tools to validate schedules. Existing scheduled jobs retain their direct delivery and appear as context in the next owner turn.

Rachel coordinates substantial independent assignments through `rachel_workers` (or `bun run workers <current-work-id> '<action-json>'`). Start a bounded named worker, inspect its status, send an addressed follow-up, or stop it. Names are unique per chief conversation; retrying a start returns the same worker. Messages require a stable `requestId` to prevent duplicate dispatch. Two background jobs can execute alongside foreground conversations; each worker's turns remain serialized. Workers use the existing configured provider, model and effort.

Managed workers preserve their brief, parent work ID, session, checkpoints, message receipts and results in the same SQLite database. Their results queue a chief review in the original chat; nearby completions share a queued review, and only the chief's reviewed report is delivered. `/workers` shows that roster and review status; `/status` includes active work even after newer messages arrive. Worker IDs and work/run IDs are distinct: `/stop` and `/resume` take work IDs. Stopping a worker also cancels its pending follow-ups. Failures, uncertain steering and restart interruptions require explicit recovery, never automatic execution retries. The default `maxTurns=8` (maximum 20) counts all work items, including messages and recovery; there are at most 32 pending worker items and four queued follow-ups per worker. These are coordination bounds, not token/spend limits; briefs must retain project-specific budgets. Workers share the filesystem and are not security-isolated; assign separate worktrees for concurrent edits.

The Codex adapter uses the documented stdio protocol, pinned to the bundled CLI version. It preserves existing thread IDs and login. Typed Rachel tools are registered on newly created threads; older threads retain the CLI equivalents until refreshed. Read-only connector discovery is available through `/capabilities`.

## How it works

Rachel runs behind a provider adapter. Depending on `AI_PROVIDER`, it uses Claude Agent SDK or the bundled Codex stdio app-server with full tool access:

- **Bash** — run any command on the server
- **File system** — read, write, edit any file
- **Web** — search the web, fetch URLs, scrape data
- **Memory** — persistent storage that survives restarts and context resets
- **Tasks** — SQLite-backed scheduler for reminders, cron jobs, and autonomous agent tasks
- **Skills** — extensible via skill files (PDF generation, Excel, web design, etc.)

## Project Structure

```
rachel8/
├── src/
│   ├── index.ts              # Entry point
│   ├── ai/
│   │   ├── index.ts          # Provider selector
│   │   ├── auth.ts           # Provider auth checks + login error mapping
│   │   ├── claude.ts         # Claude Agent SDK adapter
│   │   ├── codex.ts          # the bundled Codex stdio app-server adapter
│   │   └── provider.ts       # Provider names + normalization
│   ├── config/
│   │   └── env.ts            # Zod-validated environment config
│   ├── telegram/
│   │   ├── bot.ts            # grammY bot instance and middleware
│   │   ├── handlers/
│   │   │   ├── auth.ts       # /login, /login_code, /login_status
│   │   │   └── message.ts    # Message handler (text, voice, photos, files)
│   │   └── middleware/
│   │       └── auth.ts       # Single-user auth guard
│   ├── setup/
│   │   ├── wizard.ts         # Interactive setup wizard
│   │   ├── install.ts        # systemd service installer
│   │   └── validate.ts       # Format validators
│   └── lib/
│       ├── login-session.ts  # Interactive CLI login session manager
│       ├── logger.ts         # Logging
│       ├── memory.ts         # Memory system (daily logs, MEMORY.md)
│       └── tasks.ts          # SQLite task scheduler
├── skills/                    # Extensible skill files
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## License

MIT
