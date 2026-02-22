#!/usr/bin/env bun
/**
 * CRM Contact Search
 *
 * Usage:
 *   bun run skills/crm/examples/search.ts                    # list all
 *   bun run skills/crm/examples/search.ts --tag lead
 *   bun run skills/crm/examples/search.ts --list hot-leads
 *   bun run skills/crm/examples/search.ts --location Milan
 *   bun run skills/crm/examples/search.ts --company Acme
 *   bun run skills/crm/examples/search.ts --name marco
 *   bun run skills/crm/examples/search.ts --phone "+39342"
 *   bun run skills/crm/examples/search.ts --email "@acme.it"
 *   bun run skills/crm/examples/search.ts --overdue
 *   bun run skills/crm/examples/search.ts --dormant 30
 */
import { allContacts, ensureArray, normalizePhone, formatContact } from "./lib.ts";

const args = process.argv.slice(2);
const contacts = await allContacts();

if (args.length === 0) {
  console.log(`Total contacts: ${contacts.length}\n`);
  contacts.forEach(c => console.log(`  ${formatContact(c)}`));
  process.exit(0);
}

const flag = args[0];
const value = args[1] ?? "";

const matchArray = (field: unknown, val: string) =>
  ensureArray(field).some(f => f.toLowerCase().includes(val.toLowerCase()));

const matchStr = (field: unknown, val: string) =>
  typeof field === "string" && field.toLowerCase().includes(val.toLowerCase());

let results = contacts;

switch (flag) {
  case "--tag":
    results = contacts.filter(c => matchArray(c.tags, value));
    break;
  case "--list":
    results = contacts.filter(c => matchArray(c.lists, value));
    break;
  case "--location":
    results = contacts.filter(c => matchStr(c.location, value));
    break;
  case "--company":
    results = contacts.filter(c => matchStr(c.company, value));
    break;
  case "--role":
    results = contacts.filter(c => matchStr(c.role, value));
    break;
  case "--name":
    results = contacts.filter(c => matchStr(c.name, value));
    break;
  case "--relationship":
    results = contacts.filter(c => String(c.relationship) === value);
    break;
  case "--phone": {
    const norm = normalizePhone(value);
    results = contacts.filter(c =>
      ensureArray(c.phone).some(p => normalizePhone(p).includes(norm.replace(/^\+/, "")))
    );
    break;
  }
  case "--email":
    results = contacts.filter(c =>
      ensureArray(c.email).some(e => e.toLowerCase().includes(value.toLowerCase()))
    );
    break;
  case "--overdue": {
    const today = new Date().toISOString().split("T")[0];
    results = contacts.filter(c => c.next_followup && String(c.next_followup) <= today);
    break;
  }
  case "--dormant": {
    const days = parseInt(value) || 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    results = contacts.filter(c => c.last_contact && String(c.last_contact) <= cutoff);
    break;
  }
  default:
    console.error(`Unknown flag: ${flag}`);
    process.exit(1);
}

console.log(`Found ${results.length} contacts:\n`);
results.forEach(c => console.log(`  ${formatContact(c)}`));
