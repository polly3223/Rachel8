#!/usr/bin/env bun
/**
 * CRM Schema Introspection
 *
 * Scans all contacts and reports every frontmatter field, its detected type, and sample values.
 *
 * Usage:
 *   bun run skills/crm/examples/schema.ts
 *
 * Output example:
 *   name          : string       (15 contacts)  e.g. "Marco Rossi", "Sarah Chen"
 *   phone         : string[]     (12 contacts)  e.g. ["+393428812201"], ["+393311234567", "+393339876543"]
 *   tags          : string[]     (10 contacts)  e.g. ["lead", "networker"], ["client"]
 *   company       : string       (8 contacts)   e.g. "Acme Consulting", "TechCorp"
 */
import { allContacts, ensureArray } from "./lib.ts";

const contacts = await allContacts();

if (contacts.length === 0) {
  console.log("No contacts in CRM.");
  process.exit(0);
}

// Collect field info
const fieldInfo = new Map<string, { count: number; types: Set<string>; samples: unknown[] }>();

for (const c of contacts) {
  for (const [key, val] of Object.entries(c)) {
    if (key === "slug" || key === "_content") continue;

    if (!fieldInfo.has(key)) {
      fieldInfo.set(key, { count: 0, types: new Set(), samples: [] });
    }
    const info = fieldInfo.get(key)!;
    info.count++;

    if (Array.isArray(val)) {
      info.types.add("string[]");
    } else if (val === null || val === undefined) {
      // skip
    } else {
      info.types.add(typeof val);
    }

    if (info.samples.length < 3) {
      info.samples.push(val);
    }
  }
}

// Sort by count descending
const sorted = [...fieldInfo.entries()].sort((a, b) => b[1].count - a[1].count);

console.log(`CRM Schema — ${contacts.length} contacts, ${sorted.length} fields\n`);

const maxKeyLen = Math.max(...sorted.map(([k]) => k.length));

for (const [key, info] of sorted) {
  const types = [...info.types].join(" | ");
  const padKey = key.padEnd(maxKeyLen);
  const padType = types.padEnd(12);
  const samples = info.samples
    .map(s => {
      if (Array.isArray(s)) return JSON.stringify(s);
      if (typeof s === "string" && s.length > 30) return `"${s.slice(0, 30)}..."`;
      return JSON.stringify(s);
    })
    .join(", ");
  console.log(`  ${padKey} : ${padType} (${info.count} contacts)  e.g. ${samples}`);
}
