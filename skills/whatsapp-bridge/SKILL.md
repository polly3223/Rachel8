---
name: whatsapp-bridge
description: Link the owner's WhatsApp, inspect retained messages and contacts, export group contacts, and send explicitly authorized messages or files through Rachel8's supervised bridge.
---

Use `bun run src/whatsapp/cli.ts <command> [args...]` from the Rachel8 repository.
The CLI talks to one independent systemd user service through a private Unix socket. It does not create competing WhatsApp connections. No outbound message is authorized merely by connecting or reading history.

## Linking

When asked to connect, run `connect-qr`. Send the resulting `$SHARED_FOLDER_PATH/whatsapp-qr.png` using `bun run src/telegram/send-file.ts <path>` while the command waits. The owner scans it through WhatsApp → Settings → Linked Devices. The command waits up to 120 seconds; the service keeps the connection after the CLI exits.

If a pairing code is preferred, use `connect <international-phone-number>` and relay the returned code. Use `status` to check the current connection. An expired link requires a fresh QR/code.

## Reading and exporting

- `groups`: group names, JIDs and member counts.
- `contacts <exact-group-name-or-JID>`: CSV output; redirect it to a file under the shared folder and send the file when requested. A participant may expose only a LID; do not invent a phone number.
- `messages <chat-name-or-JID> [limit]`: retained messages, including available history sync.
- `search <name-or-phone>`: find contact names and JIDs.
- `search-messages <text>`: search retained message text.

History availability depends on what WhatsApp actually syncs. A missing result does not prove a message was never sent. Names and messages persist in `rachel-memory/whatsapp.db`; linked-device credentials remain in `rachel-memory/whatsapp-auth/`. Do not print credentials.

## Authorized sends and unlinking

Use `send <exact-contact-name-or-phone-or-JID> <text>` or `send-file <recipient> <path> [caption]` only for a send the owner explicitly requested. Ambiguous contact names are rejected; resolve the intended recipient before sending. Never automatically retry an ambiguous send failure: it may already have been delivered.

`disconnect` logs out the actual linked socket before clearing local authentication. An error means remote unlinking has not been confirmed; do not claim success. Retained message history is preserved.

The bridge requires a working systemd user session on Linux. For diagnosing a stopped bridge, use `systemctl --user status rachel8-whatsapp` and its journal; this does not authorize a send or a new account link.
