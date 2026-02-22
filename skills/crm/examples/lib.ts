/**
 * CRM shared utilities — normalization, parsing, dedup.
 * Import from any CRM script: import { ... } from "./lib.ts";
 */
import matter from "gray-matter";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const CRM_ROOT = `${process.env.SHARED_FOLDER_PATH ?? "/data"}/rachel-memory/crm`;
export const CONTACTS_DIR = `${CRM_ROOT}/contacts`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields that are ALWAYS arrays (even with single value) */
const ARRAY_FIELDS = new Set(["phone", "email", "tags", "lists"]);

export interface Contact {
  slug: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Normalize phone to E.164-like: +XXXXXXXXXXX (digits only with leading +) */
export function normalizePhone(raw: string): string {
  // Strip everything except digits and leading +
  let cleaned = raw.replace(/[^\d+]/g, "");
  // 0039... → +39...
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  // No + prefix: assume Italian if starts with 3 and 10 digits
  if (!cleaned.startsWith("+")) {
    if (cleaned.startsWith("3") && cleaned.length === 10) {
      cleaned = "+39" + cleaned;
    } else if (cleaned.startsWith("39") && cleaned.length === 12) {
      cleaned = "+" + cleaned;
    } else {
      cleaned = "+" + cleaned; // best effort
    }
  }
  return cleaned;
}

/** Normalize email: lowercase, trim */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Ensure a field value is an array */
export function ensureArray(val: unknown): string[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
}

/** Normalize all array + special fields in a contact data object */
export function normalizeContactData(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  // Force array fields
  for (const field of ARRAY_FIELDS) {
    if (out[field] !== undefined) {
      out[field] = ensureArray(out[field]);
    }
  }
  // Normalize phones
  if (Array.isArray(out.phone)) {
    out.phone = (out.phone as string[]).map(normalizePhone);
  }
  // Normalize emails
  if (Array.isArray(out.email)) {
    out.email = (out.email as string[]).map(normalizeEmail);
  }
  return out;
}

// ---------------------------------------------------------------------------
// File I/O (Bun native)
// ---------------------------------------------------------------------------

/** Read and parse a single contact.md. Returns null if not found. */
export async function readContact(slug: string): Promise<Contact | null> {
  const file = Bun.file(join(CONTACTS_DIR, slug, "contact.md"));
  if (!(await file.exists())) return null;
  const raw = await file.text();
  const { data, content } = matter(raw);
  return { slug, ...normalizeContactData(data as Record<string, unknown>), _content: content };
}

/** Read ALL contacts in parallel. */
export async function allContacts(): Promise<Contact[]> {
  try {
    const entries = await readdir(CONTACTS_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());
    const results = await Promise.all(dirs.map(e => readContact(e.name)));
    return results.filter((c): c is Contact => c !== null);
  } catch {
    return [];
  }
}

/** Write a contact.md file using gray-matter stringify. */
export async function writeContact(
  slug: string,
  data: Record<string, unknown>,
  content: string,
): Promise<void> {
  const dir = join(CONTACTS_DIR, slug);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const { _content, slug: _slug, ...frontmatter } = data;
  const normalized = normalizeContactData(frontmatter);
  const md = matter.stringify(content, normalized);
  await Bun.write(join(dir, "contact.md"), md);
}

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/** Find existing contact matching by phone, email, or name slug. Returns slug or null. */
export async function findDuplicate(
  phones: string[],
  emails: string[],
  name: string,
  contacts?: Contact[],
): Promise<string | null> {
  const all = contacts ?? await allContacts();
  const normPhones = new Set(phones.map(normalizePhone));
  const normEmails = new Set(emails.map(normalizeEmail));
  const nameSlug = slugify(name);

  for (const c of all) {
    // Phone match
    const cPhones = ensureArray(c.phone);
    if (cPhones.some(p => normPhones.has(normalizePhone(p)))) return c.slug;
    // Email match
    const cEmails = ensureArray(c.email);
    if (cEmails.some(e => normEmails.has(normalizeEmail(e)))) return c.slug;
    // Name slug match (exact or starts-with for numbered dupes)
    if (c.slug === nameSlug || c.slug.startsWith(nameSlug + "-")) return c.slug;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatContact(c: Contact): string {
  const parts = [String(c.name ?? c.slug)];
  if (c.role) parts.push(`(${c.role})`);
  if (c.company) parts.push(`@ ${c.company}`);
  const phones = ensureArray(c.phone);
  if (phones.length) parts.push(`| ${phones[0]}`);
  const emails = ensureArray(c.email);
  if (emails.length) parts.push(`| ${emails[0]}`);
  if (c.location) parts.push(`| ${c.location}`);
  if (c.relationship) parts.push(`[${c.relationship}]`);
  if (c.next_followup) parts.push(`| follow-up: ${c.next_followup}`);
  return parts.join(" ");
}
