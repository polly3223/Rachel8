#!/usr/bin/env bun
/**
 * CRM Add/Merge Contact
 *
 * Usage:
 *   bun run skills/crm/examples/add-contact.ts "Marco Rossi" \
 *     --phone "+39 342 881 2201" --email "marco@acme.it" \
 *     --company "Acme" --role "Sales Director" \
 *     --tags "lead,networker" --lists "hot-leads" \
 *     --source "WhatsApp group"
 *
 * If a contact with the same phone/email/name already exists, merges into it.
 */
import matter from "gray-matter";
import { join } from "node:path";
import {
  CRM_DIR, slugify, normalizePhone, normalizeEmail, ensureArray,
  normalizeContactData, allContacts, findDuplicate, readContact,
} from "./lib.ts";
import { mkdirSync, existsSync } from "node:fs";

// --- Parse CLI args ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: add-contact.ts "Name" [--phone ...] [--company ...] ...');
  process.exit(1);
}

const name = args[0]!;
const flags: Record<string, string> = {};
for (let i = 1; i < args.length; i += 2) {
  if (args[i]?.startsWith("--") && args[i + 1]) {
    flags[args[i].slice(2)] = args[i + 1];
  }
}

// Build new contact data
const newPhones = flags.phone ? flags.phone.split(",").map(s => normalizePhone(s.trim())) : [];
const newEmails = flags.email ? flags.email.split(",").map(s => normalizeEmail(s.trim())) : [];

const contacts = await allContacts();
const dupSlug = await findDuplicate(newPhones, newEmails, name, contacts);

const today = new Date().toISOString().split("T")[0];

if (dupSlug) {
  // --- MERGE into existing ---
  const existing = await readContact(dupSlug);
  if (!existing) { console.error("Could not read existing contact:", dupSlug); process.exit(1); }

  const file = Bun.file(join(CRM_DIR, dupSlug, "contact.md"));
  const raw = await file.text();
  const { data, content } = matter(raw);
  const d = normalizeContactData(data as Record<string, unknown>);

  // Merge phones (add new, deduplicate)
  const existingPhones = new Set(ensureArray(d.phone));
  for (const p of newPhones) if (!existingPhones.has(p)) existingPhones.add(p);
  d.phone = [...existingPhones];

  // Merge emails
  const existingEmails = new Set(ensureArray(d.email));
  for (const e of newEmails) if (!existingEmails.has(e)) existingEmails.add(e);
  d.email = [...existingEmails];

  // Merge tags
  if (flags.tags) {
    const existingTags = new Set(ensureArray(d.tags));
    for (const t of flags.tags.split(",").map(s => s.trim())) existingTags.add(t);
    d.tags = [...existingTags];
  }

  // Merge lists
  if (flags.lists) {
    const existingLists = new Set(ensureArray(d.lists));
    for (const l of flags.lists.split(",").map(s => s.trim())) existingLists.add(l);
    d.lists = [...existingLists];
  }

  // Fill empty fields (don't overwrite existing)
  for (const key of ["company", "role", "location", "source", "linkedin", "instagram", "whatsapp", "website", "twitter"]) {
    if (flags[key] && !d[key]) d[key] = flags[key];
  }

  d.last_contact = today;

  // Append merge note
  const mergeNote = `\n### ${today}\nMerged new data (source: ${flags.source ?? "manual"}). Added: ${newPhones.length ? "phone " + newPhones.join(", ") : ""}${newEmails.length ? " email " + newEmails.join(", ") : ""}.\n`;

  const { slug: _, _content: __, ...frontmatter } = d;
  const md = matter.stringify(content + mergeNote, frontmatter);
  await Bun.write(join(CRM_DIR, dupSlug, "contact.md"), md);
  console.log(`Merged into existing: ${dupSlug}/contact.md`);

} else {
  // --- CREATE new ---
  let slug = slugify(name);
  if (existsSync(join(CRM_DIR, slug))) {
    let i = 2;
    while (existsSync(join(CRM_DIR, `${slug}-${i}`))) i++;
    slug = `${slug}-${i}`;
  }

  const dir = join(CRM_DIR, slug);
  mkdirSync(dir, { recursive: true });

  const data: Record<string, unknown> = { name };
  if (newPhones.length) data.phone = newPhones;
  if (newEmails.length) data.email = newEmails;
  if (flags.company) data.company = flags.company;
  if (flags.role) data.role = flags.role;
  if (flags.location) data.location = flags.location;
  if (flags.tags) data.tags = flags.tags.split(",").map(s => s.trim());
  if (flags.lists) data.lists = flags.lists.split(",").map(s => s.trim());
  if (flags.source) data.source = flags.source;
  if (flags.linkedin) data.linkedin = flags.linkedin;
  if (flags.instagram) data.instagram = flags.instagram;
  if (flags.whatsapp) data.whatsapp = flags.whatsapp || newPhones[0];
  data.met = today;
  data.last_contact = today;
  data.relationship = "cold";

  const content = `\n## Notes\n\n## Interactions\n### ${today}\nContact added to CRM.\n`;
  const md = matter.stringify(content, normalizeContactData(data));
  await Bun.write(join(dir, "contact.md"), md);
  console.log(`Created: ${dir}/contact.md`);
}
