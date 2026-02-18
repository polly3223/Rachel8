/**
 * WhatsApp Bridge — powered by Baileys
 *
 * Provides WhatsApp Web connectivity via QR code or pairing code.
 * Used by Rachel to manage WhatsApp on behalf of the user.
 *
 * Uses the bare Baileys reconnect pattern: on disconnect, call startSock() fresh.
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

const SHARED = process.env["SHARED_FOLDER_PATH"] ?? join(process.env["HOME"] ?? "/home/rachel", "shared");
const AUTH_DIR = join(SHARED, "rachel-memory", "whatsapp-auth");

const BROWSER = Browsers.macOS("Google Chrome");
const CONTACTS_FILE = join(AUTH_DIR, "contact-names.json");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sock: WASocket | null = null;
let connectionStatus: "disconnected" | "connecting" | "connected" = "disconnected";
let contactNames = new Map<string, string>();

// Load persisted contact names from disk
async function loadContactNames(): Promise<void> {
  try {
    const data = await Bun.file(CONTACTS_FILE).text();
    const parsed = JSON.parse(data) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed)) {
      contactNames.set(k, v);
    }
  } catch { /* no file yet */ }
}

async function saveContactNames(): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of contactNames) obj[k] = v;
  await Bun.write(CONTACTS_FILE, JSON.stringify(obj));
}

// Callbacks for one-time connection events (QR ready, pairing code ready, connected)
let onQR: ((qr: string) => void) | null = null;
let onPairingCode: ((code: string) => void) | null = null;
let onConnected: (() => void) | null = null;
let onFailed: ((err: Error) => void) | null = null;

// Connection mode for reconnects
let currentMode: ConnectMode = "qr";
let currentPhone: string | undefined;

// ---------------------------------------------------------------------------
// Core: startSock — the Baileys-recommended pattern
// ---------------------------------------------------------------------------

async function startSock(): Promise<void> {
  await loadContactNames();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    browser: BROWSER,
    syncFullHistory: true,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  const usePairing = currentMode === "pairing" && !!currentPhone;
  let pairingRequested = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (usePairing && !pairingRequested && !state.creds.registered) {
        pairingRequested = true;
        try {
          const clean = currentPhone!.replace(/[^0-9]/g, "");
          const code = await sock!.requestPairingCode(clean);
          logger.info("WhatsApp pairing code generated", { code });
          onPairingCode?.(code);
          onPairingCode = null;
        } catch (err) {
          logger.error("Failed to request pairing code", { error: String(err) });
          onFailed?.(err as Error);
          onFailed = null;
        }
      } else if (!usePairing) {
        onQR?.(qr);
        onQR = null;
      }
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      logger.warn("WhatsApp disconnected", { code });

      if (code === DisconnectReason.loggedOut) {
        connectionStatus = "disconnected";
        sock = null;
        logger.info("WhatsApp logged out — session cleared");
      } else {
        // 515 or any other disconnect — just call startSock() fresh
        connectionStatus = "connecting";
        sock = null;
        logger.info("Reconnecting to WhatsApp...");
        startSock();
      }
    } else if (connection === "open") {
      connectionStatus = "connected";
      logger.info("WhatsApp connected");
      onConnected?.();
      onConnected = null;
    }
  });

  // Cache contact names as they sync — persist to disk
  sock.ev.on("contacts.upsert", (contacts) => {
    for (const c of contacts) {
      const name = c.notify || c.name;
      if (name) contactNames.set(c.id, name);
    }
    saveContactNames();
  });

  sock.ev.on("contacts.update", (updates) => {
    for (const u of updates) {
      const name = (u as any).notify || (u as any).name;
      if (name && u.id) contactNames.set(u.id, name);
    }
    saveContactNames();
  });

  // Collect push names from history sync
  sock.ev.on("messaging-history.set", (data) => {
    for (const c of (data as any).contacts ?? []) {
      const n = c.notify || c.name;
      if (n) contactNames.set(c.id, n);
    }
    for (const msg of (data as any).messages ?? []) {
      if (msg.pushName) {
        const sender = msg.key?.participant || msg.key?.remoteJid || "";
        if (sender) contactNames.set(sender, msg.pushName);
      }
    }
    logger.info("History sync received", { contacts: contactNames.size });
    saveContactNames();
  });

  // Listen for messages
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

// ---------------------------------------------------------------------------
// Connection API
// ---------------------------------------------------------------------------

export type ConnectMode = "pairing" | "qr";

export async function connect(
  mode: ConnectMode = "pairing",
  phoneNumber?: string,
): Promise<{ qrDataUrl?: string; pairingCode?: string; alreadyConnected?: boolean }> {
  if (connectionStatus === "connected" && sock) {
    return { alreadyConnected: true };
  }

  currentMode = mode;
  currentPhone = phoneNumber;
  connectionStatus = "connecting";

  return new Promise((resolve, reject) => {
    onQR = async (qr: string) => {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 400 });
        resolve({ qrDataUrl: dataUrl });
      } catch (err) {
        reject(err);
      }
    };

    onPairingCode = (code: string) => {
      resolve({ pairingCode: code });
    };

    onConnected = () => {
      resolve({ alreadyConnected: true });
    };

    onFailed = (err: Error) => {
      reject(err);
    };

    startSock().catch(reject);
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
    // Use phoneNumber field (real number) if available, fall back to id (may be LID)
    const phoneJid = (p as any).phoneNumber ?? p.id;
    const phone = phoneJid.split("@")[0];
    const name = contactNames.get(p.id) || contactNames.get(phoneJid) || phone;
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
// Message cache
// ---------------------------------------------------------------------------

const messageCache: Map<string, proto.IWebMessageInfo[]> = new Map();
const MAX_CACHED_PER_CHAT = 200;

// setupMessageListener is now a no-op — messages are listened in startSock()
export function setupMessageListener(): void {}

export interface SimpleMessage {
  from: string;
  fromMe: boolean;
  text: string;
  timestamp: number;
}

export function getRecentMessages(chatJidOrName: string, limit = 20): SimpleMessage[] {
  let messages = messageCache.get(chatJidOrName);

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
    .map((msg) => {
      const key = msg.key;
      const participant = key?.participant ?? key?.remoteJid ?? "";
      return {
        from: contactNames.get(participant) ?? (participant || "unknown"),
        fromMe: key?.fromMe ?? false,
        text:
          (msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          msg.message?.imageMessage?.caption ??
          msg.message?.videoMessage?.caption ??
          (msg.message?.documentMessage ? `[Document: ${msg.message.documentMessage.fileName ?? "file"}]` : "")) ||
          "[media]",
        timestamp: Number(msg.messageTimestamp ?? 0),
      };
    });
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
        phone: jid.split("@")[0] ?? jid,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertConnected(): void {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp not connected. Use connect() first.");
  }
}

function resolveJid(input: string): string {
  if (input.includes("@s.whatsapp.net")) return input;
  if (input.includes("@g.us")) return input;

  // Phone number — strip + and spaces
  const clean = input.replace(/[^0-9]/g, "");
  if (clean.length >= 7) {
    return `${clean}@s.whatsapp.net`;
  }

  // Name search — find in contacts, prefer @s.whatsapp.net JIDs over @lid
  const lower = input.toLowerCase();
  let lidMatch: string | null = null;

  for (const [jid, name] of contactNames.entries()) {
    if (name.toLowerCase().includes(lower)) {
      if (jid.endsWith("@s.whatsapp.net")) {
        return jid; // Perfect match — real phone JID
      }
      if (!lidMatch) lidMatch = jid;
    }
  }

  // If we only found a LID match, try to resolve it to a phone JID
  if (lidMatch && lidMatch.endsWith("@lid")) {
    // Look up the LID's name, then find a @s.whatsapp.net entry with the same name
    const lidName = contactNames.get(lidMatch);
    if (lidName) {
      for (const [jid, name] of contactNames.entries()) {
        if (jid.endsWith("@s.whatsapp.net") && name === lidName) {
          return jid;
        }
      }
    }
    // No phone JID found — return LID as last resort (may work for some operations)
    return lidMatch;
  }

  throw new Error(`Cannot resolve "${input}" to a WhatsApp contact. Try a phone number or exact name.`);
}
