#!/usr/bin/env bun
/**
 * CRM Overdue Follow-ups Report
 *
 * Usage:
 *   bun run skills/crm/examples/overdue-report.ts
 *
 * Shows contacts with next_followup date in the past, sorted by urgency.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CRM_DIR = `${process.env.SHARED_FOLDER_PATH ?? "/data"}/rachel-memory/crm`;

interface Contact {
  slug: string;
  name: string;
  next_followup?: string;
  last_contact?: string;
  company?: string;
  role?: string;
  relationship?: string;
  phone?: string;
}

function parseContact(slug: string): Contact | null {
  const file = join(CRM_DIR, slug, "contact.md");
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m?.[1]) return null;
  const fields: Record<string, unknown> = { slug };
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields as Contact;
}

const today = new Date().toISOString().split("T")[0];

if (!existsSync(CRM_DIR)) { console.log("CRM directory not found"); process.exit(0); }

const contacts = readdirSync(CRM_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== "_templates")
  .map(e => parseContact(e.name))
  .filter((c): c is Contact => c !== null && !!c.next_followup && c.next_followup <= today)
  .sort((a, b) => (a.next_followup ?? "").localeCompare(b.next_followup ?? ""));

if (contacts.length === 0) {
  console.log("No overdue follow-ups.");
  process.exit(0);
}

console.log(`Overdue follow-ups (${contacts.length}):\n`);
for (const c of contacts) {
  const daysOverdue = Math.floor((Date.now() - new Date(c.next_followup!).getTime()) / 86400000);
  console.log(`  ${c.name} — ${daysOverdue} days overdue (due: ${c.next_followup})`);
  if (c.company) console.log(`    ${c.role ?? ""} @ ${c.company}`);
  if (c.phone) console.log(`    ${c.phone}`);
  if (c.last_contact) console.log(`    Last contact: ${c.last_contact}`);
  console.log();
}
