# Rachel

Personal AI assistant on Telegram, powered by Claude or Codex. Runs 24/7 on your server — builds landing pages, tracks leads, manages contacts, creates documents, schedules tasks, does research, and more. All from a simple Telegram message.

Rachel supports both the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) and the [OpenAI Codex SDK](https://developers.openai.com/codex/sdk/). Choose the provider with `AI_PROVIDER=claudecode` or `AI_PROVIDER=codex` in `.env`.

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

`bun run setup` is the real configuration step. It writes `.env`.

`scripts/install.sh` is only a convenience bootstrap: it checks prerequisites, clones the repo into `~/rachel8`, installs dependencies, and then runs `bun run setup` for you.

If you already have the repo checked out, skip `scripts/install.sh` and just use `bun run setup`.

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

### 4. Install your agent runtime

Pick one:

For `AI_PROVIDER=claudecode`:

```bash
curl -fsSL https://claude.ai/install.sh | bash
source ~/.bashrc
claude login
claude -p 'say hello'
```

For `AI_PROVIDER=codex`:

```bash
bun x codex login
```

Rachel expects the selected app to already be installed and logged in on the server. There are no provider-specific auth settings in `.env`.

### 5. Clone and install

```bash
gh repo clone <your-username>/rachel ~/rachel8
cd ~/rachel8
bun install
```

### 6. Run the setup wizard

```bash
bun run setup
```

The wizard will ask for:
- **Telegram bot token** — create one via [@BotFather](https://t.me/BotFather) (`/newbot`)
- **Your Telegram user ID** — send `/start` to [@userinfobot](https://t.me/userinfobot)
- **AI provider** — `claudecode` or `codex`
- **Shared folder path** — where Rachel stores memory, files, and data
- **systemd service** — optionally installs Rachel as a background service

### 7. Start Rachel

If you installed the systemd service (recommended):

```bash
sudo systemctl start rachel8
sudo systemctl status rachel8
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
bun test             # Run tests
```

## How it works

Rachel runs behind a provider adapter. Depending on `AI_PROVIDER`, it uses Claude Agent SDK or OpenAI Codex SDK with full tool access:

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
│   │   ├── claude.ts         # Claude Agent SDK adapter
│   │   └── codex.ts          # OpenAI Codex SDK adapter
│   ├── config/
│   │   └── env.ts            # Zod-validated environment config
│   ├── telegram/
│   │   ├── bot.ts            # grammY bot instance and middleware
│   │   ├── handlers/
│   │   │   └── message.ts    # Message handler (text, voice, photos, files)
│   │   └── middleware/
│   │       └── auth.ts       # Single-user auth guard
│   ├── setup/
│   │   ├── wizard.ts         # Interactive setup wizard
│   │   ├── install.ts        # systemd service installer
│   │   └── validate.ts       # Format validators
│   └── lib/
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
