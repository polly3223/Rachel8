# WhatsApp Bridge Skill

You can interact with the user's WhatsApp account through a bridge built on Baileys. This lets you read/send messages, export group contacts, and manage WhatsApp — all from Telegram.

## Setup

The WhatsApp CLI lives at `src/whatsapp/cli.ts`. Run commands with:
```bash
bun run src/whatsapp/cli.ts <command> [args...]
```

## First-time Connection (Pairing Code — Default)

When the user asks to connect WhatsApp:

1. Ask the user for their phone number (with country code, e.g. +393343502266)
2. Run: `bun run src/whatsapp/cli.ts connect "+393343502266"`
3. This returns an 8-character pairing code (e.g. `ABCD-EFGH`)
4. **Send the pairing code to the user on Telegram** and tell them:
   - Open WhatsApp → Settings → Linked Devices → Link a Device
   - Tap "Link with phone number instead"
   - Enter the code
5. The script waits up to 120 seconds for pairing
6. Once paired, the session persists — no need to pair again on restart

This is the preferred method because it works entirely on the phone — no second screen needed!

## Alternative: QR Code Connection

If the user explicitly asks for QR code login (e.g. they have a second device):

1. Run: `bun run src/whatsapp/cli.ts connect-qr`
2. This saves a QR code image at `/home/rachel/shared/whatsapp-qr.png`
3. **Send this QR image to the user on Telegram** so they can scan it
4. Tell the user: "Open WhatsApp → Settings → Linked Devices → Link a Device → scan this QR code"

## Available Commands

### Connect via pairing code (default)
```bash
bun run src/whatsapp/cli.ts connect "+393343502266"
```
Returns a pairing code to give to the user. Phone number must include country code.

### Connect via QR code (alternative)
```bash
bun run src/whatsapp/cli.ts connect-qr
```
Saves QR image to `/home/rachel/shared/whatsapp-qr.png`. Send it to the user on Telegram.

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
| "Connect my WhatsApp" | Ask for phone number, run `connect "<phone>"`, send pairing code |
| "Connect WhatsApp with QR" | Run `connect-qr`, send QR image |
| "Show my WhatsApp groups" | Run `groups` |
| "Export contacts from [group]" | Run `contacts "[group]"`, send CSV |
| "Send [message] to [person]" | Run `send "[person]" "[message]"` |
| "Send this file to [person] on WhatsApp" | Run `send-file "[person]" "/path/to/file"` |
| "What did [person] say?" | Run `messages "[person]"` |
| "Find [name] in my contacts" | Run `search "[name]"` |
| "Disconnect WhatsApp" | Run `disconnect` |
