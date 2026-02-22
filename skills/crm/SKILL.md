---
name: crm
description: Conversational CRM for managing contacts, leads, relationships, and follow-ups. Use when the user mentions contacts, leads, prospects, clients, follow-ups, meetings, networking, CRM, "who did I talk to", "remind me to call", "add contact", "show my leads", "find people", outreach, relationship tracking, or any people/business relationship management. Also use when scheduling follow-ups or preparing for meetings.
---

# CRM Skill

Manage contacts, relationships, and follow-ups through natural conversation. Data lives in markdown files — one directory per contact under `$SHARED_FOLDER_PATH/rachel-memory/crm/`.

## Directory Structure

```
rachel-memory/crm/
  marco-rossi/
    contact.md        ← main file (frontmatter + notes + interactions)
    proposal-v2.pdf   ← any related files
    contract.docx
  sarah-chen/
    contact.md
    meeting-notes.md
```

- Each contact is a **directory** named as a slug: lowercase, hyphens, no spaces (e.g. `marco-rossi`)
- `contact.md` is always the main file
- Any other files in the dir are associated with that contact (contracts, images, notes, etc.)
- If two people share a name, append a number: `marco-rossi-2` (but FIRST verify they are not the same person)

## Contact File Format

`contact.md` uses YAML frontmatter for structured metadata and markdown body for notes/interactions:

```markdown
---
name: Marco Rossi
phone: "+39 342 881 2201"
email: marco.rossi@acme.it
company: Acme Consulting
role: Sales Director
location: Turin, Italy
tags: [lead, networker, real-estate]
lists: [hot-leads, networkers-turin]
source: "WhatsApp group - Imprenditori Torino"
met: 2026-02-15
last_contact: 2026-02-20
next_followup: 2026-02-27
relationship: warm
linkedin: https://linkedin.com/in/marcorossi
instagram: "@marcorossi"
---

## Notes
- Met at Turin networking event
- Interested in AI for his sales team
- Budget decision in Q2

## Interactions
### 2026-02-20
Called, discussed Rachel demo. Wants to see landing page feature.

### 2026-02-15
First contact at event. Exchanged numbers.
```

### Frontmatter Fields

Required: `name`
Common: `phone`, `email`, `company`, `role`, `location`, `tags`, `lists`, `source`, `met`, `last_contact`, `next_followup`, `relationship`
Optional: `linkedin`, `instagram`, `twitter`, `website`, any other field as needed

- `tags`: array — categorize the contact (lead, client, partner, friend, investor, vendor, etc.)
- `lists`: array — named groups for filtering (hot-leads, event-feb-2026, real-estate-milan, etc.)
- `relationship`: one of `cold`, `warm`, `hot`, `client`, `friend`, `dormant`
- `last_contact`: ISO date of most recent interaction
- `next_followup`: ISO date — when to follow up next
- `met`: ISO date — when you first met this person

## Working With Contacts

### Reading & Querying

For simple lookups (1-2 contacts), read the file directly.

For queries across multiple contacts (filtering, searching, reporting), write and run a Bun script. Do NOT manually scan every file — always use programmatic access.

See `examples/search.ts` in the skill directory for reference patterns. Adapt and extend as needed — write new scripts for any query the user needs.

Common patterns:
- Find contacts by tag, list, location, company, role
- Find overdue follow-ups (next_followup < today)
- Find dormant relationships (last_contact older than N days)
- Count contacts by tag or list
- Export contacts as CSV/Excel

### Adding Contacts

1. Create dir: `$SHARED_FOLDER_PATH/rachel-memory/crm/{slug}/`
2. Create `contact.md` with frontmatter + initial notes
3. Set `met` to today if not specified
4. Set `last_contact` to today
5. If the user provides extra files (photos, docs), save them in the same dir

Before creating: search existing contacts to avoid duplicates. If a similar name exists, ask the user to confirm it's a different person.

### Updating Contacts

- To add an interaction: append a new dated section under `## Interactions`
- To update metadata: modify the frontmatter fields
- Always update `last_contact` when logging a new interaction
- When setting a follow-up: update `next_followup` in frontmatter AND schedule an agent task (see below)

### Deleting Contacts

Remove the entire contact directory. Ask for confirmation first.

## Follow-ups & Reminders

CRITICAL: Never use "reminder" type tasks. Always use "agent" type tasks for follow-ups.

When the user says "follow up with Marco in a week" or "remind me to call Sarah on Monday":

1. Update `next_followup` in the contact's frontmatter
2. Schedule an **agent task** with a prompt that references the contact file path:

```bash
sqlite3 $SHARED_FOLDER_PATH/rachel9/data.db "INSERT INTO tasks (name, type, data, next_run) VALUES (
  'followup-marco-rossi',
  'agent',
  '{\"prompt\":\"Follow-up due for Marco Rossi. Read $SHARED_FOLDER_PATH/rachel-memory/crm/marco-rossi/contact.md for full context. Review the latest interactions, understand what was discussed and what the next step is. Send the user: 1) a brief reminder of who Marco is and what is pending, 2) a suggested action, 3) a draft message if appropriate. After sending, update last_contact to today and ask the user if they want to set a new follow-up.\"}',
  $(date -d '2026-02-27 09:00 UTC' +%s)000
);"
```

This way, when the task fires, Rachel wakes up with full tool access, reads the contact file, and sends an intelligent briefing — not just a dumb text notification.

For recurring follow-up sequences (e.g. "check in every 2 weeks"):
- Use a cron-based agent task
- The prompt should include: read the contact, check if there's been recent interaction, if not send a nudge

## Scripting Patterns

The examples/ dir contains starter scripts. Use them as reference, adapt freely, or write new ones for the user's specific needs. Scripts run with `bun run`.

Key pattern for parsing frontmatter in Bun/TypeScript:

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CRM_DIR = `${process.env.SHARED_FOLDER_PATH ?? "/data"}/rachel-memory/crm`;

interface Contact {
  slug: string;
  name: string;
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
    if (typeof val === "string" && val.startsWith("["))
      val = val.replace(/[\[\]]/g, "").split(",").map((s: string) => s.trim());
    fields[kv[1]] = val;
  }
  return fields as Contact;
}

function allContacts(): Contact[] {
  if (!existsSync(CRM_DIR)) return [];
  return readdirSync(CRM_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== "_templates")
    .map(e => parseContact(e.name))
    .filter((c): c is Contact => c !== null);
}
```

Use this as a building block. Write scripts that filter, sort, export, or transform contacts as needed. Delete scripts after one-time use if they're not reusable, or keep useful ones in the examples/ dir.

## Meeting Prep

When the user says "I'm meeting [name] tomorrow" or "prep me for a call with [name]":

1. Read the contact file
2. If contact enrichment data exists, include it
3. Summarize: who they are, company, role, how you met, past interactions, what's pending
4. Suggest talking points based on interaction history
5. If no contact file exists, offer to create one and do web research

## Bulk Operations

For importing contacts from WhatsApp groups, CSV files, or other sources:

1. Parse the source data
2. For each contact, check for existing duplicates by name/phone
3. Create contact dirs and files
4. Report: "Created X new contacts, skipped Y duplicates"

When exporting: write a script that collects frontmatter fields and outputs CSV/Excel.

## Important Rules

1. Always use `$SHARED_FOLDER_PATH/rachel-memory/crm/` as the CRM root
2. Always use agent tasks (never reminder tasks) for follow-ups
3. Always include the contact file path in agent task prompts
4. Always update `last_contact` when logging interactions
5. Always check for duplicates before creating contacts
6. For multi-contact queries, always write scripts — never manually read each file
7. The user speaks naturally — interpret "add Marco, salesman from Milan, met yesterday" correctly
8. When in doubt about a contact's identity (possible duplicate), ask the user
