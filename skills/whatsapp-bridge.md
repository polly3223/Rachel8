# WhatsApp Bridge Skill

You can interact with the user's WhatsApp account through a bridge built on Baileys. This lets you read/send messages, export group contacts, and manage WhatsApp — all from Telegram.

## Setup

The WhatsApp CLI lives at `src/whatsapp/cli.ts`. Run commands with:
```bash
bun run src/whatsapp/cli.ts <command> [args...]
```

## First-time Connection

When the user asks to connect WhatsApp:

1. Run: `bun run src/whatsapp/cli.ts connect`
2. This generates a QR code image at `/home/rachel/shared/whatsapp-qr.png`
3. **Send this QR image to the user on Telegram** so they can scan it with their phone
4. The script waits up to 60 seconds for the scan
5. Once scanned, the session persists — no need to scan again on restart

Tell the user: "Open WhatsApp → Settings → Linked Devices → Link a Device → scan this QR code"

## Available Commands

### Check status
```bash
bun run src/whatsapp/cli.ts status
```
Returns "connected" or "disconnected".

### List all groups
```bash
bun run src/whatsapp/cli.ts groups
```
Shows all groups with member count and JID.

### Export group contacts (KILLER FEATURE)
```bash
bun run src/whatsapp/cli.ts contacts "Group Name"
```
- Exports all members as CSV (name, phone, admin status)
- CSV saved to `/home/rachel/shared/whatsapp-contacts-<group>.csv`
- **Send the CSV file to the user on Telegram**
- Supports fuzzy name matching — partial group name works

### Send a message
```bash
bun run src/whatsapp/cli.ts send "+393343502266" "Hey, how are you?"
bun run src/whatsapp/cli.ts send "Marco" "Hi Marco!"
```
The `<to>` field accepts: phone number (with country code), contact name, or WhatsApp JID.

### Send a file
```bash
bun run src/whatsapp/cli.ts send-file "+393343502266" "/path/to/file.pdf" "Here's the report"
```
Supports images, videos, audio, and documents. Caption is optional.

### Read recent messages
```bash
bun run src/whatsapp/cli.ts messages "Marco" 20
```
Shows last N messages from a chat. Only works for messages received while connected.

### Search contacts
```bash
bun run src/whatsapp/cli.ts search "Marco"
```
Finds contacts matching a name or phone number.

### Disconnect
```bash
bun run src/whatsapp/cli.ts disconnect
```
Logs out and clears the session. User will need to scan QR again.

## Important Notes

- Session auth is stored at `~/shared/rachel-memory/whatsapp-auth/` — persists across restarts
- Contact names sync when connecting — first few seconds may only show phone numbers
- The `messages` command only shows messages received while the bridge was connected (not full history)
- Group contact export works immediately — no history needed
- When sending files to the user on Telegram, use the file path directly (the shared folder is accessible)
- Phone numbers should include country code (e.g., 393343502266 for Italian numbers)

## Common User Requests → Commands

| User says | What to do |
|-----------|------------|
| "Connect my WhatsApp" | Run `connect`, send QR image |
| "Show my WhatsApp groups" | Run `groups` |
| "Export contacts from [group]" | Run `contacts "[group]"`, send CSV |
| "Send [message] to [person]" | Run `send "[person]" "[message]"` |
| "Send this file to [person] on WhatsApp" | Run `send-file "[person]" "/path/to/file"` |
| "What did [person] say?" | Run `messages "[person]"` |
| "Find [name] in my contacts" | Run `search "[name]"` |
| "Disconnect WhatsApp" | Run `disconnect` |
