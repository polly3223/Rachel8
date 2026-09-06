import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeMessageContent, type proto } from "baileys";

export class WhatsAppStore {
  readonly db: Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS contacts(jid TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(chat TEXT NOT NULL,id TEXT NOT NULL,sender TEXT NOT NULL,from_me INTEGER,
        timestamp INTEGER,text TEXT NOT NULL, UNIQUE(chat,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(text,content='messages',content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS message_insert AFTER INSERT ON messages BEGIN
        INSERT INTO message_search(rowid,text) VALUES(new.rowid,new.text); END;
      CREATE TRIGGER IF NOT EXISTS message_update AFTER UPDATE ON messages BEGIN
        INSERT INTO message_search(message_search,rowid,text) VALUES('delete',old.rowid,old.text);
        INSERT INTO message_search(rowid,text) VALUES(new.rowid,new.text); END;`);
  }
  contacts(values: { id?: string; name?: string | null; notify?: string | null }[]): void {
    this.db.transaction(() => {
      for (const c of values)
        if (c.id && (c.name || c.notify))
          this.db.run("INSERT OR REPLACE INTO contacts VALUES(?,?)", [
            c.id,
            c.notify || c.name || "",
          ]);
    })();
  }
  messages(values: proto.IWebMessageInfo[]): void {
    this.db.transaction(() => {
      for (const m of values) {
        const chat = m.key?.remoteJid,
          id = m.key?.id;
        if (!chat || !id || !m.message) continue;
        const content = normalizeMessageContent(m.message);
        const text =
          content?.conversation ??
          content?.extendedTextMessage?.text ??
          content?.imageMessage?.caption ??
          content?.videoMessage?.caption ??
          (content?.documentMessage
            ? `[Document: ${content.documentMessage.fileName ?? "file"}]`
            : "[media]");
        const sender = m.key?.participant ?? chat;
        if (m.pushName) this.contacts([{ id: sender, name: m.pushName }]);
        this.db.run(
          `INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(chat,id) DO UPDATE SET text=excluded.text`,
          [chat, id, sender, m.key?.fromMe ? 1 : 0, Number(m.messageTimestamp ?? 0), text],
        );
      }
    })();
  }
  recent(chat: string, limit = 20): unknown[] {
    if (/^\+?[\d\s()-]+$/.test(chat)) chat = this.resolve(chat);
    return this.db
      .query(
        `SELECT m.*,COALESCE(c.name,m.sender) AS name FROM messages m LEFT JOIN contacts c ON c.jid=m.sender
      WHERE m.chat=? OR m.chat IN (SELECT jid FROM contacts WHERE name LIKE ?) ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(chat, `%${chat}%`, Math.max(1, Math.min(200, limit)))
      .reverse();
  }
  search(query: string, limit = 30): unknown[] {
    const term = query
      .split(/\s+/)
      .filter(Boolean)
      .map((v) => `"${v.replace(/"/g, '""')}"`)
      .join(" AND ");
    if (!term) return [];
    return this.db
      .query(
        `SELECT m.* FROM message_search s JOIN messages m ON m.rowid=s.rowid WHERE message_search MATCH ? ORDER BY m.timestamp DESC LIMIT ?`,
      )
      .all(term, Math.max(1, Math.min(100, limit)));
  }
  contactSearch(query: string): { jid: string; name: string }[] {
    return this.db
      .query("SELECT * FROM contacts WHERE name LIKE ? OR jid LIKE ? ORDER BY name LIMIT 100")
      .all(`%${query}%`, `%${query}%`) as { jid: string; name: string }[];
  }
  resolve(input: string): string {
    if (/^[^\s@]+@(s\.whatsapp\.net|g\.us|lid)$/.test(input)) return input;
    if (/^\+?[\d\s()-]+$/.test(input) && input.replace(/\D/g, "").length >= 7)
      return `${input.replace(/\D/g, "")}@s.whatsapp.net`;
    const matches = this.contactSearch(input).filter(
      (c) => c.name.toLowerCase() === input.toLowerCase(),
    );
    const phone = matches.filter((c) => c.jid.endsWith("@s.whatsapp.net"));
    const candidates = phone.length ? phone : matches;
    if (candidates.length !== 1)
      throw new Error("Contact is missing or ambiguous. Use an exact phone number or JID.");
    return candidates[0]!.jid;
  }
}
