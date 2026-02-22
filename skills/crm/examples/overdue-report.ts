#!/usr/bin/env bun
/**
 * CRM Overdue Follow-ups Report
 *
 * Usage:
 *   bun run skills/crm/examples/overdue-report.ts
 */
import { allContacts, ensureArray } from "./lib.ts";

const today = new Date().toISOString().split("T")[0];
const contacts = await allContacts();

const overdue = contacts
  .filter(c => c.next_followup && String(c.next_followup) <= today)
  .sort((a, b) => String(a.next_followup ?? "").localeCompare(String(b.next_followup ?? "")));

if (overdue.length === 0) {
  console.log("No overdue follow-ups.");
  process.exit(0);
}

console.log(`Overdue follow-ups (${overdue.length}):\n`);
for (const c of overdue) {
  const daysOverdue = Math.floor(
    (Date.now() - new Date(String(c.next_followup)).getTime()) / 86400000
  );
  console.log(`  ${c.name} — ${daysOverdue} days overdue (due: ${c.next_followup})`);
  if (c.company) console.log(`    ${c.role ?? ""} @ ${c.company}`);
  const phones = ensureArray(c.phone);
  if (phones.length) console.log(`    ${phones.join(", ")}`);
  if (c.last_contact) console.log(`    Last contact: ${c.last_contact}`);
  console.log();
}
