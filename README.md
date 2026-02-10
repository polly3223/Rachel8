# Rachel8

Personal AI assistant on Telegram, powered by Claude. Runs 24/7 on your VPS with reliable scheduled tasks, file management, and shell access.

Rachel uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) — no API key needed, works with your Claude Max/Pro subscription.

## Setup (fresh VPS)

All commands below assume a fresh Ubuntu server. Run everything in order.

### 1. Create the `rachel` user (as root)

SSH in as root, then create a dedicated user with passwordless sudo. Rachel's Agent SDK requires a non-root user, but she needs sudo for shell commands.

```bash
adduser rachel --ingroup users --disabled-password
echo 'rachel ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/rachel
chmod 0440 /etc/sudoers.d/rachel
```

Press Enter through the Full Name / Room / Phone prompts. Then switch to the new user:

```bash
su - rachel
```

**All remaining steps run as `rachel`.**

### 2. Install system dependencies, GitHub CLI, and Bun

```bash
sudo apt update && sudo apt install -y unzip gh
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 3. Log in to GitHub

```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account.

### 4. Install Claude Code and log in

```bash
curl -fsSL https://claude.ai/install.sh | bash
source ~/.bashrc
claude login
```

Follow the prompts to authenticate with your Claude Max/Pro subscription.

Verify it works:

```bash
claude -p 'say hello'
```

### 5. Clone and install

```bash
gh repo clone polly3223/Rachel8 ~/rachel8
cd ~/rachel8
bun install
```

### 6. Run the setup wizard

```bash
bun run setup
```

The wizard will ask for everything interactively:
- **Telegram bot token** — create one via [@BotFather](https://t.me/BotFather) (`/newbot`)
- **Your Telegram user ID** — send `/start` to [@userinfobot](https://t.me/userinfobot)
- **Exa API key** — get from https://dashboard.exa.ai/api-keys
- **Shared folder path** — auto-detects `/data/shared/vault` if it exists
- **systemd service** — optionally installs and starts Rachel as a service

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
4. Choose a username (e.g., "rachel8_bot")
5. Copy the token — you'll paste it into the setup wizard

## Development

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

## Project Structure

```
rachel8/
├── src/
│   ├── index.ts              # Entry point
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
├── rachel8.service            # systemd unit file template
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## License

MIT
