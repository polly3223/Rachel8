---
name: crm
description: Conversational CRM for managing contacts, leads, relationships, and follow-ups. Use when the user mentions contacts, leads, prospects, clients, follow-ups, meetings, networking, CRM, "who did I talk to", "remind me to call", "add contact", "show my leads", "find people", outreach, relationship tracking, or any people/business relationship management. Also use when scheduling follow-ups or preparing for meetings.
---

# CRM Skill

Manage contacts, relationships, and follow-ups through natural conversation. Data lives in markdown files — one directory per contact under `$SHARED_FOLDER_PATH/rachel-memory/crm/`.

## Working Directory

The CRM root is `$SHARED_FOLDER_PATH/rachel-memory/crm/`. This is a **Bun project** with its own `package.json` and dependencies. ALL CRM scripts run from here.

On first use, if the project isn't initialized yet:
```bash
cd $SHARED_FOLDER_PATH/rachel-memory/crm && bun init -y && bun add gray-matter
```

When writing new scripts, always create them in `scripts/` within this dir and run with `bun run scripts/my-script.ts` from the CRM root. This ensures gray-matter and any other deps are available.

## Directory Structure

```
rachel-memory/crm/
  package.json        ← bun project
  bun.lock
  node_modules/
  scripts/            ← CRM scripts (seed scripts + any you create)
    lib.ts            ← shared utilities (normalize, parse, dedup, format)
    search.ts         ← search/filter contacts
    add-contact.ts    ← create/merge contacts
    overdue-report.ts ← find overdue follow-ups
    schema.ts         ← introspect all frontmatter fields + types
  contacts/           ← all contact directories live here
    marco-rossi/
      contact.md      ← main file (frontmatter + notes + interactions)
      proposal-v2.pdf ← any related files
    sarah-chen/
      contact.md
      meeting-notes.md
```

Scripts and contacts are separated cleanly. When you need a new dependency, just `bun add <package>` in the CRM root.

- Each contact is a **directory** inside `contacts/`, named as a slug: lowercase, hyphens, no spaces (e.g. `marco-rossi`)
- `contact.md` is always the main file
- Any other files in the dir are associated with that contact (contracts, images, notes, etc.)
- If two people share a name, append a number: `marco-rossi-2` — but FIRST verify they are not the same person by checking phone, email, company

## Contact File Format

`contact.md` uses YAML frontmatter + markdown body:

```markdown
---
name: Marco Rossi
phone:
  - "+393428812201"
  - "+393311234567"
email:
  - marco.rossi@acme.it
company: Acme Consulting
role: Sales Director
location: Turin, Italy
tags: [lead, networker, real-estate]
lists: [hot-leads, networkers-turin]
source: WhatsApp group - Imprenditori Torino
met: 2026-02-15
last_contact: 2026-02-20
next_followup: 2026-02-27
relationship: warm
linkedin: https://linkedin.com/in/marcorossi
instagram: marcorossi
whatsapp: "+393428812201"
---

## Notes
- Met at Turin networking event
- Interested in AI for his sales team

## Interactions
### 2026-02-20
Called, discussed Rachel demo. Wants to see landing page feature.

### 2026-02-15
First contact at event. Exchanged numbers.
```

### Field Types — Always Array vs Always Single

Fields that CAN have multiple values are ALWAYS stored as arrays, even if there's currently just one:
- `phone: ["+393428812201"]` — always array
- `email: ["marco@acme.it"]` — always array
- `tags: [lead]` — always array
- `lists: [hot-leads]` — always array

Fields that are inherently singular are always strings:
- `name`, `company`, `role`, `location`, `source`, `relationship` — always string
- `met`, `last_contact`, `next_followup` — always string (ISO date)
- `linkedin`, `instagram`, `twitter`, `website`, `whatsapp` — always string

### Phone Number Normalization

ALL phone numbers must be stored in E.164-like format: digits only with leading `+`, no spaces, no dashes, no parentheses.

Normalization: strip everything except digits and leading `+`. If no `+`, assume Italian (+39) if it starts with 3 and has 10 digits.

Examples:
- `+39 342 881 2201` → `"+393428812201"`
- `342 881 2201` → `"+393428812201"` (Italian assumed)
- `0039 342 881 2201` → `"+393428812201"`
- `(342) 881-2201` → `"+393428812201"`

### Email Normalization

Always lowercase, trim whitespace. That's it.

### Deduplication Strategy

Before adding a contact, ALWAYS check for duplicates by:
1. Normalized phone number match (check every phone in the array)
2. Normalized email match
3. Slug/name similarity (fuzzy — same slugified name)

If a match is found: **merge into the existing contact** rather than creating a new one. Add new phone numbers/emails to the arrays, update fields that were empty, append new interaction notes. Never silently drop data.

When importing from WhatsApp groups: a contact may only have a phone number. Normalize it and check against all existing contacts' phone arrays. If found → update that contact. If not → create new.

## Working With Contacts

### Scripting Rules

1. Always `cd $SHARED_FOLDER_PATH/rachel-memory/crm` before running scripts
2. Use `gray-matter` for all frontmatter parsing/serialization
3. Use `Bun.file().text()` for reading, `Bun.write()` for writing
4. Use `readdir` from `node:fs/promises` with `withFileTypes` for listing
5. For multi-contact queries, ALWAYS read files in parallel (`Promise.all`)
6. Write scripts on the fly for whatever the user needs — save them in `scripts/`
7. Import shared utilities from `./lib.ts` (normalization, parsing, dedup)
8. When you need new dependencies: `bun add <package>` in the CRM root
9. Keep useful scripts, delete one-off throwaway scripts after use

### Adding Contacts

1. Normalize all phone numbers and emails
2. Check for duplicates (phone, email, name)
3. If duplicate found: merge (add new data, don't overwrite existing)
4. If new: create dir + contact.md with proper array fields
5. Set `met` and `last_contact` to today if not specified

### Updating Contacts

- To add an interaction: append a dated section under `## Interactions`
- To update metadata: re-parse with gray-matter, modify data, re-serialize with gray-matter
- Always update `last_contact` when logging a new interaction
- When setting a follow-up: update `next_followup` AND schedule an agent task

### Bulk Import

For WhatsApp group imports, CSV imports, or any bulk operation:
1. Parse all entries
2. Normalize all phone/email values
3. Load ALL existing contacts into memory (parallel reads)
4. For each entry: check duplicates → merge or create
5. Report: "Created X new, merged Y existing, Z total"

## Follow-ups & Reminders

CRITICAL: Never use "reminder" type tasks. Always use "agent" type tasks.

When scheduling a follow-up:
1. Update `next_followup` in frontmatter
2. Schedule an **agent task** referencing the contact file path:

```bash
sqlite3 $SHARED_FOLDER_PATH/rachel9/data.db "INSERT INTO tasks (name, type, data, next_run) VALUES (
  'followup-marco-rossi',
  'agent',
  '{\"prompt\":\"Follow-up due for Marco Rossi. Read $SHARED_FOLDER_PATH/rachel-memory/crm/contacts/marco-rossi/contact.md for full context. Review latest interactions, send the user: 1) who Marco is and what is pending, 2) suggested action, 3) draft message if appropriate. Update last_contact and ask about next follow-up.\"}',
  $(date -d '2026-02-27 09:00 UTC' +%s)000
);"
```

## Meeting Prep

When user says "I'm meeting [name] tomorrow":
1. Read the contact file
2. Summarize: who, company, role, how you met, past interactions, pending items
3. Suggest talking points
4. If no contact exists, offer to create one and do web research

## Scripts

The CRM dir has seed scripts in `scripts/`. Run them with `bun run scripts/<name>.ts` from the CRM root:

- `lib.ts` — shared utilities: normalizePhone, normalizeEmail, ensureArray, readContact, allContacts, writeContact, findDuplicate, formatContact, slugify
- `search.ts` — filter by --tag, --list, --location, --company, --name, --phone, --email, --overdue, --dormant
- `add-contact.ts` — create or merge contacts with full normalization + dedup
- `overdue-report.ts` — find contacts with overdue follow-ups
- `schema.ts` — introspect all frontmatter fields with types and sample values

The `examples/` dir in the skill folder contains the same seed scripts as reference. The live working copies are in the CRM dir at `$SHARED_FOLDER_PATH/rachel-memory/crm/scripts/`.

Write new scripts freely — import from `./lib.ts` for utilities. Example:
```typescript
import { allContacts, ensureArray } from "./lib.ts";
const contacts = await allContacts();
// ... your custom logic
```

## Important Rules

1. Always normalize phones (E.164) and emails (lowercase) before storing or searching
2. Always use arrays for phone, email, tags, lists — even for single values
3. Always check for duplicates before creating contacts
4. Always use agent tasks (never reminder) for follow-ups, with contact file path in prompt
5. Always use gray-matter for frontmatter, Bun native APIs for file I/O
6. Always read multiple files in parallel (Promise.all)
7. Always update `last_contact` when logging interactions
8. Interpret natural language: "add Marco, salesman from Milan, met yesterday" → correct fields
