#!/usr/bin/env bun
/**
 * WhatsApp CLI — used by Rachel agent to interact with WhatsApp.
 *
 * Usage:
 *   bun run src/whatsapp/cli.ts connect <phone>   → Pairing code (default, phone-only)
 *   bun run src/whatsapp/cli.ts connect-qr         → QR code (saved as PNG)
 *   bun run src/whatsapp/cli.ts status              → Check connection status
 *   bun run src/whatsapp/cli.ts groups              → List all groups
 *   bun run src/whatsapp/cli.ts contacts <group>    → Export group contacts as CSV
 *   bun run src/whatsapp/cli.ts send <to> <msg>     → Send a message
 *   bun run src/whatsapp/cli.ts send-file <to> <path> [caption]  → Send a file
 *   bun run src/whatsapp/cli.ts messages <chat> [limit]  → Read recent messages
 *   bun run src/whatsapp/cli.ts search <query>      → Search contacts by name/number
 *   bun run src/whatsapp/cli.ts disconnect           → Logout and clear session
 */

import {
  connect,
  disconnect,
  getStatus,
  isConnected,
  listGroups,
  getGroupContacts,
  contactsToCsv,
  sendMessage,
  sendFile,
  getRecentMessages,
  searchContacts,
  setupMessageListener,
} from "./client.ts";
import { join } from "path";

const SHARED = join(process.env.HOME ?? "/home/rachel", "shared");
const QR_PATH = join(SHARED, "whatsapp-qr.png");

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case "connect": {
      // Default: pairing code (needs phone number)
      const phone = args[0];
      if (!phone) {
        console.error("Usage: connect <phone number with country code>");
        console.error("Example: connect +393343502266");
        console.error("\nFor QR code login instead, use: connect-qr");
        process.exit(1);
      }

      console.log("Connecting to WhatsApp via pairing code...");
      const result = await connect("pairing", phone);

      if (result.alreadyConnected) {
        console.log("Already connected to WhatsApp!");
        setupMessageListener();
        return;
      }

      if (result.pairingCode) {
        console.log(`\nPairing code: ${result.pairingCode}`);
        console.log("\nTell the user to:");
        console.log("1. Open WhatsApp on their phone");
        console.log("2. Go to Settings → Linked Devices → Link a Device");
        console.log("3. Tap 'Link with phone number instead'");
        console.log(`4. Enter this code: ${result.pairingCode}`);
        console.log("\nWaiting for pairing...");

        // Wait for connection (up to 120 seconds for pairing)
        const timeout = Date.now() + 120_000;
        while (Date.now() < timeout) {
          await new Promise((r) => setTimeout(r, 2000));
          if (isConnected()) {
            console.log("WhatsApp connected successfully!");
            setupMessageListener();
            await new Promise((r) => setTimeout(r, 3000));
            return;
          }
        }
        console.error("Timed out waiting for pairing. Try again.");
        process.exit(1);
      }
      break;
    }

    case "connect-qr": {
      console.log("Connecting to WhatsApp via QR code...");
      const result = await connect("qr");

      if (result.alreadyConnected) {
        console.log("Already connected to WhatsApp!");
        setupMessageListener();
        return;
      }

      if (result.qrDataUrl) {
        const base64 = result.qrDataUrl.split(",")[1];
        const buffer = Buffer.from(base64, "base64");
        await Bun.write(QR_PATH, buffer);
        console.log(`QR code saved to: ${QR_PATH}`);
        console.log("Send this image to the user on Telegram so they can scan it.");
        console.log("Waiting for scan...");

        const timeout = Date.now() + 120_000;
        while (Date.now() < timeout) {
          await new Promise((r) => setTimeout(r, 2000));
          if (isConnected()) {
            console.log("WhatsApp connected successfully!");
            setupMessageListener();
            await new Promise((r) => setTimeout(r, 3000));
            return;
          }
        }
        console.error("Timed out waiting for QR scan. Try again.");
        process.exit(1);
      }
      break;
    }

    case "status": {
      // Quick status check — try to reconnect from saved session
      const result = await connect();
      if (result.alreadyConnected || isConnected()) {
        console.log("connected");
      } else {
        console.log("disconnected");
      }
      break;
    }

    case "groups": {
      await ensureConnected();
      const groups = await listGroups();
      if (groups.length === 0) {
        console.log("No groups found.");
        return;
      }
      console.log(`Found ${groups.length} groups:\n`);
      for (const g of groups) {
        console.log(`- ${g.name} (${g.memberCount} members) [${g.jid}]`);
      }
      break;
    }

    case "contacts": {
      const groupName = args.join(" ");
      if (!groupName) {
        console.error("Usage: contacts <group name or JID>");
        process.exit(1);
      }

      await ensureConnected(true);
      const { groupName: name, contacts } = await getGroupContacts(groupName);
      const csv = contactsToCsv(contacts);

      // Save CSV
      const csvPath = join(SHARED, `whatsapp-contacts-${name.replace(/[^a-zA-Z0-9]/g, "_")}.csv`);
      await Bun.write(csvPath, csv);

      console.log(`Exported ${contacts.length} contacts from "${name}"`);
      console.log(`CSV saved to: ${csvPath}`);
      console.log("\nPreview:");
      console.log(csv.split("\n").slice(0, 11).join("\n"));
      if (contacts.length > 10) {
        console.log(`... and ${contacts.length - 10} more`);
      }
      break;
    }

    case "send": {
      const to = args[0];
      const text = args.slice(1).join(" ");
      if (!to || !text) {
        console.error("Usage: send <phone/name/JID> <message>");
        process.exit(1);
      }

      await ensureConnected();
      await sendMessage(to, text);
      console.log(`Message sent to ${to}`);
      break;
    }

    case "send-file": {
      const to = args[0];
      const filePath = args[1];
      const caption = args.slice(2).join(" ") || undefined;
      if (!to || !filePath) {
        console.error("Usage: send-file <phone/name/JID> <file-path> [caption]");
        process.exit(1);
      }

      await ensureConnected();
      await sendFile(to, filePath, caption);
      console.log(`File sent to ${to}`);
      break;
    }

    case "messages": {
      const chat = args[0];
      const limit = parseInt(args[1] ?? "20", 10);
      if (!chat) {
        console.error("Usage: messages <chat name/phone/JID> [limit]");
        process.exit(1);
      }

      await ensureConnected();
      const messages = getRecentMessages(chat, limit);
      if (messages.length === 0) {
        console.log("No cached messages found for this chat. Messages appear after they are received while connected.");
        return;
      }
      for (const m of messages) {
        const time = new Date(m.timestamp * 1000).toLocaleString("en-GB", { timeZone: "Europe/Zurich" });
        const prefix = m.fromMe ? "You" : m.from;
        console.log(`[${time}] ${prefix}: ${m.text}`);
      }
      break;
    }

    case "search": {
      const query = args.join(" ");
      if (!query) {
        console.error("Usage: search <name or phone>");
        process.exit(1);
      }

      await ensureConnected();
      const results = searchContacts(query);
      if (results.length === 0) {
        console.log("No contacts found matching that query.");
        return;
      }
      console.log(`Found ${results.length} contacts:\n`);
      for (const c of results) {
        console.log(`- ${c.name} (${c.phone})`);
      }
      break;
    }

    case "disconnect": {
      await disconnect();
      console.log("WhatsApp disconnected and session cleared.");
      break;
    }

    default:
      console.log(`WhatsApp Bridge CLI

Commands:
  connect <phone>      Link via pairing code (default, phone-only flow)
  connect-qr           Link via QR code (needs second screen)
  status               Check connection status
  groups               List all WhatsApp groups
  contacts <group>     Export group contacts as CSV
  send <to> <message>  Send a text message
  send-file <to> <path> [caption]  Send a file
  messages <chat> [n]  Read recent messages from a chat
  search <query>       Search contacts by name or phone
  disconnect           Logout and clear session

<phone> = number with country code, e.g. +393343502266
<to> can be: phone number, contact name, or JID`);
  }

  // Keep process alive briefly for async operations to complete
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
}

async function ensureConnected(waitForSync = false): Promise<void> {
  if (!isConnected()) {
    // Try to restore from saved session (no interactive auth)
    const result = await connect("qr");
    if (!result.alreadyConnected && !isConnected()) {
      // Wait a few seconds — session might still be restoring
      await new Promise((r) => setTimeout(r, 5000));
      if (!isConnected()) {
        console.error("WhatsApp not connected. Run 'connect <phone>' first to link your account.");
        process.exit(1);
      }
    }
    setupMessageListener();
    // Wait for contact sync (push names arrive via contacts.upsert)
    if (waitForSync) {
      console.log("Waiting for contact sync...");
      await new Promise((r) => setTimeout(r, 15000));
    } else {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
