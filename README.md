# Rachel8

Personal AI assistant on Telegram, powered by Claude Opus 4.6. Runs 24/7 on your VPS with reliable scheduled tasks, file management, and shell access.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/rachel8/main/scripts/install.sh | bash
```

This clones the repo, installs dependencies, and launches the interactive setup wizard.

## VPS Setup (from zero)

Step-by-step for a fresh Hetzner VPS (or any Ubuntu/Debian server):

### 1. Create VPS

Create a server on [Hetzner Cloud](https://console.hetzner.cloud/) with Ubuntu 22.04+ and your preferred plan.

### 2. SSH in and create a non-root user

```bash
ssh root@your-vps-ip
adduser lory
usermod -aG sudo lory
su - lory
```

### 3. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 4. Install git and Node.js

```bash
sudo apt update && sudo apt install -y git nodejs npm
```

### 5. Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

Follow the prompts to authenticate with your Claude subscription.

### 6. Create shared folder (for Syncthing integration)

```bash
sudo mkdir -p /data/shared/vault
sudo chown $USER:$USER /data/shared/vault
```

### 7. Configure Syncthing (optional)

Syncthing keeps the shared vault in sync between your VPS and local machine.

- Install Syncthing on both machines: https://syncthing.net/downloads/
- On VPS: share `/data/shared/vault`
- On local machine: sync to `~/RachelShared/vault`
- See [Syncthing Getting Started](https://docs.syncthing.net/intro/getting-started.html) for detailed instructions

### 8. Install Rachel8

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/rachel8/main/scripts/install.sh | bash
```

### 9. Follow the setup wizard

The wizard will ask for your API keys and configure everything. See [What You'll Need](#what-youll-need) below.

## What You'll Need

Before running the setup wizard, have these ready:

- **Claude Code CLI** -- Rachel uses the Claude Agent SDK (powered by your Claude subscription):
  1. Install: `npm install -g @anthropic-ai/claude-code`
  2. Log in: `claude login` (uses your Claude Max/Pro subscription)

- **Telegram bot token** -- Create via @BotFather on Telegram:
  1. Open Telegram, search for `@BotFather`
  2. Send `/newbot`
  3. Choose a name (e.g., "Rachel")
  4. Choose a username (e.g., "rachel8_bot")
  5. Copy the token BotFather gives you (format: `123456789:ABC...`)

- **Exa API key** -- Get from https://dashboard.exa.ai/api-keys
  - Sign up for an Exa account
  - Create an API key

## Development

For local development:

```bash
bun run dev          # Start with hot reload (bun --watch)
bun run start        # Start normally
bun run setup        # Re-run setup wizard
bun test             # Run tests
```

## Service Management

Rachel runs as a systemd service on the VPS:

```bash
sudo systemctl status rachel8      # Check status
sudo systemctl restart rachel8     # Restart
sudo systemctl stop rachel8        # Stop
sudo journalctl -u rachel8 -f      # Follow logs
sudo journalctl -u rachel8 -n 50   # Last 50 log lines
```

After a crash loop, reset and restart:

```bash
sudo systemctl reset-failed rachel8
sudo systemctl start rachel8
```

## Project Structure

```
rachel8/
├── src/
│   ├── index.ts              # Entry point — starts Rachel
│   ├── ai/
│   │   └── claude.ts         # Claude Agent SDK client
│   ├── config/
│   │   └── env.ts            # Zod-validated environment config
│   ├── telegram/
│   │   ├── bot.ts            # grammY bot instance and middleware
│   │   ├── handlers/
│   │   │   └── message.ts    # Text message handler
│   │   └── middleware/
│   │       └── auth.ts       # Single-user auth guard
│   ├── setup/
│   │   ├── wizard.ts         # Interactive setup wizard
│   │   ├── install.ts        # systemd service installer
│   │   └── validate.ts       # Format validators
│   └── lib/
│       └── logger.ts         # Thin logging wrapper
├── scripts/
│   └── install.sh            # curl | bash one-liner installer
├── rachel8.service            # systemd unit file template
├── package.json
├── tsconfig.json
├── .env.example               # Template for required env vars
└── README.md
```

## License

MIT
