/**
 * WhatsApp Bridge — powered by Baileys
 *
 * Provides WhatsApp Web connectivity via QR code or pairing code.
 * Used by Rachel to manage WhatsApp on behalf of the user.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  type WASocket,
  type GroupMetadata,
  type proto,
} from "baileys";
import QRCode from "qrcode";
import { join } from "path";
import { logger } from "../lib/logger.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_DIR = join(
  process.env.HOME ?? "/home/rachel",
  "shared",
  "rachel-memory",
  "whatsapp-auth"
);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sock: WASocket | null = null;
let connectionStatus: "disconnected" | "connecting" | "connected" = "disconnected";
let lastQR: string | null = null;
let contactNames = new Map<string, string>();

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type ConnectMode = "pairing" | "qr";

export async function connect(
  mode: ConnectMode = "pairing",
  phoneNumber?: string,
): Promise<{ qrDataUrl?: string; pairingCode?: string; alreadyConnected?: boolean }> {
  if (connectionStatus === "connected" && sock) {
    return { alreadyConnected: true };
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  connectionStatus = "connecting";

  const usePairing = mode === "pairing" && !!phoneNumber;

  return new Promise((resolve, reject) => {
    sock = makeWASocket({
      auth: state,
      browser: usePairing ? Browsers.ubuntu("Chrome") : Browsers.macOS("Desktop"),
      syncFullHistory: false,
      printQRInTerminal: false,
    });

    sock.ev.on("creds.update", saveCreds);

    let pairingRequested = false;

    sock.ev.on("connection.update", async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        lastQR = qr;

        if (usePairing && !pairingRequested) {
          // Request pairing code instead of showing QR
          pairingRequested = true;
          try {
            const clean = phoneNumber!.replace(/[^0-9]/g, "");
            const code = await sock!.requestPairingCode(clean);
            logger.info("WhatsApp pairing code generated", { code });
            resolve({ pairingCode: code });
          } catch (err) {
            logger.error("Failed to request pairing code", { error: String(err) });
            reject(err);
          }
        } else if (!usePairing) {
          // QR mode
          try {
            const dataUrl = await QRCode.toDataURL(qr, { width: 400 });
            resolve({ qrDataUrl: dataUrl });
          } catch (err) {
            logger.error("Failed to generate QR", { error: String(err) });
            reject(err);
          }
        }
      }

      if (connection === "open") {
        connectionStatus = "connected";
        lastQR = null;
        logger.info("WhatsApp connected");
        resolve({ alreadyConnected: true });
      }

      if (connection === "close") {
        connectionStatus = "disconnected";
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          logger.info("WhatsApp logged out — session cleared");
          sock = null;
        } else {
          logger.warn("WhatsApp disconnected, will reconnect on next command", { code });
          sock = null;
        }
      }
    });

    // Cache contact names as they sync
    sock.ev.on("contacts.upsert", (contacts) => {
      for (const c of contacts) {
        const name = c.notify || c.name || c.id.split("@")[0];
        contactNames.set(c.id, name);
      }
    });

    // Also listen for contact updates
    sock.ev.on("contacts.update", (updates) => {
      for (const u of updates) {
        if (u.id && (u.notify || u.name)) {
          contactNames.set(u.id, u.notify || u.name || u.id.split("@")[0]);
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

export function getStatus(): string {
  return connectionStatus;
}

export function isConnected(): boolean {
  return connectionStatus === "connected" && sock !== null;
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function disconnect(): Promise<void> {
  if (sock) {
    await sock.logout();
    sock = null;
  }
  connectionStatus = "disconnected";
  contactNames.clear();
  logger.info("WhatsApp disconnected");
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface GroupInfo {
  jid: string;
  name: string;
  memberCount: number;
  description?: string;
}

export async function listGroups(): Promise<GroupInfo[]> {
  assertConnected();
  const groups = await sock!.groupFetchAllParticipating();
  return Object.entries(groups).map(([jid, meta]) => ({
    jid,
    name: meta.subject,
    memberCount: meta.participants.length,
    description: meta.desc ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Group contacts export
// ---------------------------------------------------------------------------

export interface GroupContact {
  phone: string;
  name: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export async function getGroupContacts(groupJidOrName: string): Promise<{ groupName: string; contacts: GroupContact[] }> {
  assertConnected();

  const groups = await sock!.groupFetchAllParticipating();
  let metadata: GroupMetadata | undefined;

  // Try exact JID match first
  if (groups[groupJidOrName]) {
    metadata = groups[groupJidOrName];
  } else {
    // Fuzzy name search
    const lower = groupJidOrName.toLowerCase();
    for (const [, meta] of Object.entries(groups)) {
      if (meta.subject.toLowerCase().includes(lower)) {
        metadata = meta;
        break;
      }
    }
  }

  if (!metadata) {
    throw new Error(`Group "${groupJidOrName}" not found. Use listGroups() to see available groups.`);
  }

  const contacts: GroupContact[] = metadata.participants.map((p) => {
    const phone = p.id.split("@")[0];
    const name = contactNames.get(p.id) || phone;
    return {
      phone,
      name,
      isAdmin: p.admin === "admin" || p.admin === "superadmin",
      isSuperAdmin: p.admin === "superadmin",
    };
  });

  return { groupName: metadata.subject, contacts };
}

export function contactsToCsv(contacts: GroupContact[]): string {
  const header = "Name,Phone,Admin";
  const rows = contacts.map(
    (c) => `"${c.name.replace(/"/g, '""')}",${c.phone},${c.isAdmin ? "yes" : "no"}`
  );
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------

export async function sendMessage(to: string, text: string): Promise<void> {
  assertConnected();
  const jid = resolveJid(to);
  await sock!.sendMessage(jid, { text });
  logger.info("WhatsApp message sent", { to: jid });
}

// ---------------------------------------------------------------------------
// Send file
// ---------------------------------------------------------------------------

export async function sendFile(to: string, filePath: string, caption?: string): Promise<void> {
  assertConnected();
  const jid = resolveJid(to);
  const file = Bun.file(filePath);
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const fileName = filePath.split("/").pop() ?? "file";

  if (mime.startsWith("image/")) {
    await sock!.sendMessage(jid, { image: buffer, caption });
  } else if (mime.startsWith("video/")) {
    await sock!.sendMessage(jid, { video: buffer, caption });
  } else if (mime.startsWith("audio/")) {
    await sock!.sendMessage(jid, { audio: buffer, mimetype: mime });
  } else {
    await sock!.sendMessage(jid, { document: buffer, mimetype: mime, fileName, caption });
  }
  logger.info("WhatsApp file sent", { to: jid, fileName });
}

// ---------------------------------------------------------------------------
// Read recent messages (from history sync cache)
// ---------------------------------------------------------------------------

const messageCache: Map<string, proto.IWebMessageInfo[]> = new Map();
const MAX_CACHED_PER_CHAT = 200;

export function setupMessageListener(): void {
  if (!sock) return;
  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid) continue;
      const existing = messageCache.get(jid) ?? [];
      existing.push(msg);
      if (existing.length > MAX_CACHED_PER_CHAT) {
        existing.splice(0, existing.length - MAX_CACHED_PER_CHAT);
      }
      messageCache.set(jid, existing);
    }
  });
}

export interface SimpleMessage {
  from: string;
  fromMe: boolean;
  text: string;
  timestamp: number;
}

export function getRecentMessages(chatJidOrName: string, limit = 20): SimpleMessage[] {
  // Try exact JID
  let messages = messageCache.get(chatJidOrName);

  // Fuzzy match by name/number
  if (!messages) {
    const lower = chatJidOrName.toLowerCase();
    for (const [jid, msgs] of messageCache.entries()) {
      const name = contactNames.get(jid)?.toLowerCase() ?? "";
      if (jid.includes(lower) || name.includes(lower)) {
        messages = msgs;
        break;
      }
    }
  }

  if (!messages) return [];

  return messages
    .slice(-limit)
    .map((msg) => ({
      from: contactNames.get(msg.key.participant ?? msg.key.remoteJid ?? "") ??
        msg.key.participant ??
        msg.key.remoteJid ??
        "unknown",
      fromMe: msg.key.fromMe ?? false,
      text:
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        (msg.message?.documentMessage ? `[Document: ${msg.message.documentMessage.fileName}]` : "") ??
        "[media]",
      timestamp: Number(msg.messageTimestamp ?? 0),
    }));
}

// ---------------------------------------------------------------------------
// Search contacts
// ---------------------------------------------------------------------------

export function searchContacts(query: string): Array<{ jid: string; name: string; phone: string }> {
  const lower = query.toLowerCase();
  const results: Array<{ jid: string; name: string; phone: string }> = [];
  for (const [jid, name] of contactNames.entries()) {
    if (
      name.toLowerCase().includes(lower) ||
      jid.includes(lower)
    ) {
      results.push({
        jid,
        name,
        phone: jid.split("@")[0],
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertConnected(): asserts sock is WASocket {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp not connected. Use connect() first.");
  }
}

function resolveJid(input: string): string {
  // Already a JID
  if (input.includes("@")) return input;

  // Phone number — strip + and spaces
  const clean = input.replace(/[^0-9]/g, "");
  if (clean.length >= 7) {
    return `${clean}@s.whatsapp.net`;
  }

  // Try name search
  for (const [jid, name] of contactNames.entries()) {
    if (name.toLowerCase().includes(input.toLowerCase())) {
      return jid;
    }
  }

  throw new Error(`Cannot resolve "${input}" to a WhatsApp contact. Try a phone number or exact name.`);
}
