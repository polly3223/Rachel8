#!/usr/bin/env bun
/**
 * CRM Add Contact — Example script
 *
 * Usage:
 *   bun run skills/crm/examples/add-contact.ts "Marco Rossi" --phone "+39 342 881 2201" --company "Acme" --role "Sales Director" --tags "lead,networker" --source "WhatsApp group"
 *
 * All flags optional except name (positional).
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CRM_DIR = `${process.env.SHARED_FOLDER_PATH ?? "/data"}/rachel-memory/crm`;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function findDuplicate(name: string, phone?: string): string | null {
  if (!existsSync(CRM_DIR)) return null;
  const slug = slugify(name);
  const dirs = readdirSync(CRM_DIR, { withFileTypes: true }).filter(e => e.isDirectory());

  for (const dir of dirs) {
    // Check slug match
    if (dir.name === slug || dir.name.startsWith(slug + "-")) {
      return dir.name;
    }
    // Check phone match
    if (phone) {
      const file = join(CRM_DIR, dir.name, "contact.md");
      if (existsSync(file)) {
        const content = readFileSync(file, "utf-8");
        const cleanPhone = phone.replace(/\s/g, "");
        if (content.includes(cleanPhone)) return dir.name;
      }
    }
  }
  return null;
}

// --- CLI ---
const args = process.argv.slice(2);
if (args.length === 0) { console.error("Usage: add-contact.ts \"Name\" [--phone ...] [--company ...] ..."); process.exit(1); }

const name = args[0];
const flags: Record<string, string> = {};
for (let i = 1; i < args.length; i += 2) {
  if (args[i].startsWith("--") && args[i + 1]) {
    flags[args[i].slice(2)] = args[i + 1];
  }
}

// Check for duplicates
const dup = findDuplicate(name, flags.phone);
if (dup) {
  console.error(`Possible duplicate found: ${dup}`);
  console.error("Verify with the user before creating a new contact.");
  process.exit(1);
}

// Create contact
let slug = slugify(name);
const contactDir = join(CRM_DIR, slug);
if (existsSync(contactDir)) {
  // Append number
  let i = 2;
  while (existsSync(join(CRM_DIR, `${slug}-${i}`))) i++;
  slug = `${slug}-${i}`;
}

const dir = join(CRM_DIR, slug);
mkdirSync(dir, { recursive: true });

const today = new Date().toISOString().split("T")[0];

const frontmatter: string[] = ["---", `name: "${name}"`];
if (flags.phone) frontmatter.push(`phone: "${flags.phone}"`);
if (flags.email) frontmatter.push(`email: "${flags.email}"`);
if (flags.company) frontmatter.push(`company: "${flags.company}"`);
if (flags.role) frontmatter.push(`role: "${flags.role}"`);
if (flags.location) frontmatter.push(`location: "${flags.location}"`);
if (flags.tags) frontmatter.push(`tags: [${flags.tags.split(",").map(t => t.trim()).join(", ")}]`);
if (flags.lists) frontmatter.push(`lists: [${flags.lists.split(",").map(t => t.trim()).join(", ")}]`);
if (flags.source) frontmatter.push(`source: "${flags.source}"`);
frontmatter.push(`met: ${today}`);
frontmatter.push(`last_contact: ${today}`);
frontmatter.push(`relationship: cold`);
frontmatter.push("---");
frontmatter.push("");
frontmatter.push("## Notes");
if (flags.notes) frontmatter.push(flags.notes);
frontmatter.push("");
frontmatter.push("## Interactions");
frontmatter.push(`### ${today}`);
frontmatter.push("Contact added to CRM.");
frontmatter.push("");

writeFileSync(join(dir, "contact.md"), frontmatter.join("\n"));
console.log(`Created: ${dir}/contact.md`);
