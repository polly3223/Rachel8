import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  type WASocket,
} from "baileys";
import QRCode from "qrcode";
import { join } from "node:path";
import { rm, chmod } from "node:fs/promises";
import { WhatsAppStore } from "./store.ts";
import { logger } from "../lib/logger.ts";

export const shared =
  Bun.env["SHARED_FOLDER_PATH"] ?? join(Bun.env["HOME"] ?? "/home/rachel", "shared");
const authDir = join(shared, "rachel-memory", "whatsapp-auth");
export const history = new WhatsAppStore(join(shared, "rachel-memory", "whatsapp.db"));
let socket: WASocket | undefined;
let status = "disconnected",
  stopping = false;
let connecting: Promise<unknown> | undefined;
let linkResult: unknown;
let savedCredentials = Promise.resolve();
let connectionTimer: ReturnType<typeof setTimeout> | undefined;
export const getStatus = () => status;

export async function connect(mode: "qr" | "pairing" = "qr", phone?: string): Promise<unknown> {
  if (status === "connected") return { alreadyConnected: true };
  if (connecting) return connecting;
  if (status === "connecting" && socket) return linkResult ?? { connecting: true };
  stopping = false;
  clearTimeout(connectionTimer);
  linkResult = undefined;
  connecting = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WhatsApp connection timed out")), 120_000);
    const ready = (result: unknown) => {
      linkResult = result;
      clearTimeout(timeout);
      resolve(result);
    };
    void start(mode, phone, ready).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  }).finally(() => {
    connecting = undefined;
  });
  return connecting;
}
async function start(
  mode: "qr" | "pairing",
  phone: string | undefined,
  ready: (result: unknown) => void,
): Promise<void> {
  if (stopping) return;
  status = "connecting";
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  await chmod(authDir, 0o700);
  if (stopping) return;
  const current = makeWASocket({
    auth: state,
    browser: Browsers.macOS("Google Chrome"),
    syncFullHistory: true,
  });
  socket = current;
  current.ev.on("creds.update", () => {
    if (!stopping)
      savedCredentials = savedCredentials
        .then(saveCreds)
        .catch(() => logger.warn("WhatsApp credential save failed"));
  });
  current.ev.on("contacts.upsert", (contacts) => history.contacts(contacts));
  current.ev.on("contacts.update", (contacts) => history.contacts(contacts));
  current.ev.on("messaging-history.set", (data) => {
    history.contacts(data.contacts);
    history.messages(data.messages);
  });
  current.ev.on("messages.upsert", (data) => history.messages(data.messages));
  current.ev.on("messages.delete", (data) => {
    if ("keys" in data)
      for (const key of data.keys)
        history.db.run("UPDATE messages SET text='[deleted]' WHERE chat=? AND id=?", [
          key.remoteJid ?? "",
          key.id ?? "",
        ]);
    else if ("jid" in data)
      history.db.run("UPDATE messages SET text='[deleted]' WHERE chat=?", [data.jid]);
  });
  let paired = false;
  current.ev.on("connection.update", (update) => {
    void (async () => {
      if (socket !== current || stopping) return;
      if (update.qr) {
        if (mode === "pairing" && phone && !paired && !state.creds.registered) {
          paired = true;
          ready({ pairingCode: await current.requestPairingCode(phone.replace(/\D/g, "")) });
        } else if (mode === "qr") {
          const path = join(shared, "whatsapp-qr.png");
          await QRCode.toFile(path, update.qr, { width: 400 });
          ready({ qrPath: path });
        }
      }
      if (update.connection === "open") {
        status = "connected";
        ready({ alreadyConnected: true });
      }
      if (update.connection === "close") {
        const error = update.lastDisconnect?.error as
          { output?: { statusCode?: number } } | undefined;
        socket = undefined;
        status = "disconnected";
        if (error?.output?.statusCode === DisconnectReason.loggedOut) return;
        connectionTimer = setTimeout(() => {
          void start(mode, phone, ready).catch(() => logger.warn("WhatsApp reconnect failed"));
        }, 3000);
      }
    })().catch(() => logger.warn("WhatsApp connection event failed"));
  });
}
async function connected(): Promise<WASocket> {
  if (status !== "connected") {
    if (!(await Bun.file(join(authDir, "creds.json")).exists()))
      throw new Error("WhatsApp is not linked. Run connect-qr first.");
    await connect();
    const end = Date.now() + 20_000;
    while (status !== "connected" && Date.now() < end) await Bun.sleep(200);
  }
  if (!socket || status !== "connected")
    throw new Error("WhatsApp is not connected; relink if necessary");
  return socket;
}
export async function disconnect(): Promise<void> {
  // Resolve the actual linked socket first; failure must never claim remote unlink success.
  const current = await connected();
  stopping = true;
  clearTimeout(connectionTimer);
  try {
    await current.logout();
    await savedCredentials;
    await rm(authDir, { recursive: true, force: true });
  } catch (error) {
    stopping = false;
    throw error;
  }
  socket = undefined;
  status = "disconnected";
}
export function shutdownWhatsApp(): void {
  stopping = true;
  clearTimeout(connectionTimer);
  socket?.end(undefined);
}
export async function restoreWhatsApp(): Promise<void> {
  const names: unknown = await Bun.file(join(authDir, "contact-names.json"))
    .json()
    .catch(() => null);
  if (names && typeof names === "object" && !Array.isArray(names))
    history.contacts(
      Object.entries(names)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([id, name]) => ({ id, name })),
    );
  if (await Bun.file(join(authDir, "creds.json")).exists()) await connect();
}
export async function groups(): Promise<unknown> {
  const all = await (await connected()).groupFetchAllParticipating();
  return Object.entries(all).map(([jid, group]) => ({
    jid,
    name: group.subject,
    memberCount: group.participants.length,
  }));
}
export async function contacts(group: string): Promise<string> {
  const all = await (await connected()).groupFetchAllParticipating();
  const matches = Object.entries(all).filter(
    ([jid, g]) => jid === group || g.subject.toLowerCase() === group.toLowerCase(),
  );
  if (matches.length !== 1) throw new Error("Use an exact, unambiguous group name or JID");
  const metadata = matches[0]![1];
  return [
    "Name,Phone,Admin",
    ...metadata.participants.map((p) => {
      const jid = p.phoneNumber ?? p.id;
      const name =
        history.contactSearch(jid).find((c) => c.jid === jid)?.name ?? jid.split("@")[0] ?? "";
      return `"${name.replace(/"/g, '""')}",${jid.split("@")[0]},${p.admin ? "yes" : "no"}`;
    }),
  ].join("\n");
}
export async function send(to: string, text: string): Promise<unknown> {
  return (await connected()).sendMessage(history.resolve(to), { text });
}
export async function sendFile(to: string, path: string, caption?: string): Promise<unknown> {
  const file = Bun.file(path),
    buffer = Buffer.from(await file.arrayBuffer()),
    mimetype = file.type;
  const content = mimetype.startsWith("image/")
    ? { image: buffer, caption }
    : mimetype.startsWith("video/")
      ? { video: buffer, caption }
      : mimetype.startsWith("audio/")
        ? { audio: buffer, mimetype }
        : { document: buffer, mimetype, fileName: path.split("/").pop(), caption };
  return (await connected()).sendMessage(history.resolve(to), content);
}
