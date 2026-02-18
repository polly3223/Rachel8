# WhatsApp Bridge Skill

You can interact with the user's WhatsApp account through a bridge built on Baileys. This lets you read/send messages, export group contacts, and manage WhatsApp — all from Telegram.

## Setup

The WhatsApp CLI lives at `src/whatsapp/cli.ts`. Run commands with:
```bash
bun run src/whatsapp/cli.ts <command> [args...]
```

## First-time Connection (QR Code — Recommended)

When the user asks to connect WhatsApp:

1. Run: `bun run src/whatsapp/cli.ts connect-qr`
2. This saves a QR code image at `$SHARED_FOLDER_PATH/whatsapp-qr.png`
3. **Send the QR image to the user on Telegram**: `bun run src/telegram/send-file.ts $SHARED_FOLDER_PATH/whatsapp-qr.png "Scan this QR code: Open WhatsApp → Settings → Linked Devices → Link a Device"`
4. Tell the user: "Open WhatsApp → Settings → Linked Devices → Link a Device → scan this QR"
5. The script waits up to 120 seconds for the scan
6. Once linked, the session persists — no need to scan again unless it expires (~14 days of inactivity)

The QR method is more reliable. The session is created with `syncFullHistory: true`, so push names (WhatsApp display names) get synced and persisted to disk automatically.

## Alternative: Pairing Code Connection

If the user prefers not to use a second screen:

1. Ask for their phone number (with country code, e.g. +393343502266)
2. Run: `bun run src/whatsapp/cli.ts connect "+393343502266"`
3. Send the 8-character pairing code to the user on Telegram
4. Tell them: WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead" → enter the code
5. Waits up to 120 seconds for pairing

## Available Commands

### Connect via QR code (recommended)
```bash
bun run src/whatsapp/cli.ts connect-qr
```
Saves QR image to `$SHARED_FOLDER_PATH/whatsapp-qr.png`. Send it to the user on Telegram.

### Connect via pairing code
```bash
bun run src/whatsapp/cli.ts connect "+393343502266"
```
Returns a pairing code. Phone number must include country code.

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

### Export group contacts (KILLER FEATURE for networkers)
```bash
bun run src/whatsapp/cli.ts contacts "Group Name"
```
- Exports all members as CSV (name, phone number, admin status)
- Names are WhatsApp push names (display names users set for themselves)
- Phone numbers are real numbers (not WhatsApp internal LIDs)
- CSV saved to `$SHARED_FOLDER_PATH/whatsapp-contacts-<group>.csv`
- **Send the CSV file to the user on Telegram**: `bun run src/telegram/send-file.ts $SHARED_FOLDER_PATH/whatsapp-contacts-<group>.csv "Contacts from <group>"`
- Supports fuzzy name matching — partial group name works
- First run after connecting takes ~15s to sync contact names

### Send a message
```bash
bun run src/whatsapp/cli.ts send "Clara" "Ciao! Come stai?"
bun run src/whatsapp/cli.ts send "+393343502266" "Hey!"
```
The `<to>` field accepts: contact name, phone number (with country code), or WhatsApp JID.
Name resolution handles LID→phone translation automatically.

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
Logs out and clears the session. User will need to link again.

## Technical Notes

- Session auth stored at `$SHARED_FOLDER_PATH/rachel-memory/whatsapp-auth/` — persists across restarts
- Contact names (push names) are persisted to `contact-names.json` in the auth dir — survive reconnects
- Names sync on first link via `contacts.upsert` and `messaging-history.set` events
- WhatsApp uses LID (Linked ID) format internally; the bridge resolves LIDs to real phone numbers automatically
- Uses `Browsers.macOS("Google Chrome")` identity — required for pairing code compatibility
- On disconnect (including 515 stream restart after linking), auto-reconnects using fresh `startSock()` pattern
- The `messages` command only shows messages received while connected (not full history)
- Phone numbers should include country code (e.g., 393343502266 for Italian numbers)

## Common User Requests → Commands

| User says | What to do |
|-----------|------------|
| "Connect my WhatsApp" | Run `connect-qr`, send QR image |
| "Connect WhatsApp with code" | Ask for phone, run `connect "<phone>"`, send code |
| "Show my WhatsApp groups" | Run `groups` |
| "Export contacts from [group]" | Run `contacts "[group]"`, send CSV file |
| "Send [message] to [person]" | Run `send "[person]" "[message]"` |
| "Send this file to [person] on WhatsApp" | Run `send-file "[person]" "/path/to/file"` |
| "What did [person] say?" | Run `messages "[person]"` |
| "Find [name] in my contacts" | Run `search "[name]"` |
| "Disconnect WhatsApp" | Run `disconnect` |
