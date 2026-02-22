#!/usr/bin/env bun
/**
 * CRM Contact Search — Example script
 *
 * Usage:
 *   bun run skills/crm/examples/search.ts --tag lead
 *   bun run skills/crm/examples/search.ts --list hot-leads
 *   bun run skills/crm/examples/search.ts --location Milan
 *   bun run skills/crm/examples/search.ts --overdue
 *   bun run skills/crm/examples/search.ts --dormant 30
 *   bun run skills/crm/examples/search.ts --name "marco"
 *   bun run skills/crm/examples/search.ts --company "acme"
 *
 * Adapt and extend as needed for any query pattern.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CRM_DIR = `${process.env.SHARED_FOLDER_PATH ?? "/data"}/rachel-memory/crm`;

interface Contact {
  slug: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  role?: string;
  location?: string;
  tags?: string[];
  lists?: string[];
  relationship?: string;
  last_contact?: string;
  next_followup?: string;
  met?: string;
  [key: string]: unknown;
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
    let val: unknown = kv[2].trim().replace(/^["']|["']$/g, "");
    if (typeof val === "string" && val.startsWith("[")) {
      val = val.replace(/[\[\]]/g, "").split(",").map((s: string) => s.trim());
    }
    fields[kv[1]] = val;
  }
  return fields as Contact;
}

function allContacts(): Contact[] {
  if (!existsSync(CRM_DIR)) { console.log("CRM directory not found:", CRM_DIR); return []; }
  return readdirSync(CRM_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== "_templates")
    .map(e => parseContact(e.name))
    .filter((c): c is Contact => c !== null);
}

function matchesArray(field: string[] | undefined, value: string): boolean {
  if (!field) return false;
  return field.some(f => f.toLowerCase().includes(value.toLowerCase()));
}

function matchesString(field: string | undefined, value: string): boolean {
  if (!field) return false;
  return field.toLowerCase().includes(value.toLowerCase());
}

function formatContact(c: Contact): string {
  const parts = [c.name];
  if (c.role) parts.push(`(${c.role})`);
  if (c.company) parts.push(`@ ${c.company}`);
  if (c.phone) parts.push(`| ${c.phone}`);
  if (c.email) parts.push(`| ${c.email}`);
  if (c.location) parts.push(`| ${c.location}`);
  if (c.relationship) parts.push(`[${c.relationship}]`);
  if (c.next_followup) parts.push(`| follow-up: ${c.next_followup}`);
  return parts.join(" ");
}

// --- CLI ---
const args = process.argv.slice(2);
const contacts = allContacts();

if (args.length === 0) {
  console.log(`Total contacts: ${contacts.length}\n`);
  contacts.forEach(c => console.log(`  ${formatContact(c)}`));
  process.exit(0);
}

let results = contacts;
const flag = args[0];
const value = args[1] ?? "";

switch (flag) {
  case "--tag":
    results = contacts.filter(c => matchesArray(c.tags, value));
    break;
  case "--list":
    results = contacts.filter(c => matchesArray(c.lists, value));
    break;
  case "--location":
    results = contacts.filter(c => matchesString(c.location, value));
    break;
  case "--company":
    results = contacts.filter(c => matchesString(c.company, value));
    break;
  case "--role":
    results = contacts.filter(c => matchesString(c.role, value));
    break;
  case "--name":
    results = contacts.filter(c => matchesString(c.name, value));
    break;
  case "--relationship":
    results = contacts.filter(c => c.relationship === value);
    break;
  case "--overdue": {
    const today = new Date().toISOString().split("T")[0];
    results = contacts.filter(c => c.next_followup && c.next_followup <= today);
    break;
  }
  case "--dormant": {
    const days = parseInt(value) || 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    results = contacts.filter(c => c.last_contact && c.last_contact <= cutoff);
    break;
  }
  default:
    console.error(`Unknown flag: ${flag}`);
    process.exit(1);
}

console.log(`Found ${results.length} contacts:\n`);
results.forEach(c => console.log(`  ${formatContact(c)}`));
