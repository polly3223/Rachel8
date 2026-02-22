---
name: social-media
description: Social media content coach and writer. Use when the user mentions social media, LinkedIn, X/Twitter, Threads, posting, content creation, content calendar, "write me a post", "what should I post", content ideas, social strategy, engagement, followers, hashtags, personal brand, thought leadership, or anything related to creating and managing social media presence.
---

# Social Media Skill

Rachel is a content coach and ghostwriter — not a posting bot. She researches what's happening in the user's world, combines it with their real experiences, and proposes authentic content in the user's voice. She also proactively coaches the user to capture content-worthy moments (photos, screenshots, stories) before they happen.

## Working Directory

All social media data lives in `$SHARED_FOLDER_PATH/rachel-memory/social-media/`.

On first use, initialize:
```bash
mkdir -p $SHARED_FOLDER_PATH/rachel-memory/social-media/{history,ideas,assets}
```

## Directory Structure

```
rachel-memory/social-media/
  profile.md          ← user's voice, niche, platforms, style samples
  schedule.md         ← content proposal schedule (user-defined)
  history/            ← posted content, organized by month
    2026-02/
      2026-02-22-linkedin-ai-crm.md
      2026-02-24-x-networking-thread.md
  ideas/              ← saved ideas not yet used
    conference-photo-idea.md
  assets/             ← images, screenshots user sends for posts
    conference-feb.jpg
```

## Onboarding — First-Time Setup

When the user first asks about social media content, gather this info conversationally (don't dump a form):

1. **Platforms**: Which ones? (LinkedIn, X, Threads — or others)
2. **Niche & topics**: What do they want to be known for? What's their industry?
3. **Target audience**: Who should read their posts?
4. **Voice samples**: Ask for 3-5 posts they wrote and liked (or links to posts they admire). Analyze: tone (casual/formal), length preference, use of emojis, storytelling style, humor level.
5. **Schedule**: When do they want content proposals? (e.g. "Monday and Thursday morning", "every 3 days", "twice a week")
6. **Content goals**: Brand awareness? Lead gen? Thought leadership? Community?

Store everything in `profile.md` (see template below). Then schedule recurring agent tasks for content proposals.

### Scheduling Agent Tasks

Use the task scheduler to create recurring content proposals:
```bash
sqlite3 $SHARED_FOLDER_PATH/rachel-memory/tasks.db "INSERT INTO tasks (name, type, schedule, data, next_run) VALUES (
  'social-media-content-cycle',
  'agent',
  '0 9 * * 1,4',
  '{\"prompt\":\"Social media content cycle. Read $SHARED_FOLDER_PATH/rachel-memory/social-media/profile.md for the user profile and voice. Read $SHARED_FOLDER_PATH/rachel-memory/social-media/schedule.md for schedule details. Then: 1) Search the web for 3-5 trending news/topics in the user niche. 2) Read recent daily logs and CRM interactions for personal experiences. 3) Check upcoming CRM events/meetings for content coaching opportunities. 4) Generate 3 post ideas using the combination method (world event x personal experience). 5) Write full drafts for each platform. 6) Send proposals to the user via Telegram. Follow all rules in the social-media skill.\"}',
  $(date -d 'next monday 09:00' +%s)000
);"
```

Adjust the cron schedule to match what the user asked for. Always use agent tasks — never reminder type.

## The Content Cycle

When the scheduled agent task fires (or when the user asks for content), follow this exact process:

### Step 1 — Research (find real seeds)

Search the web for what's happening in the user's niche RIGHT NOW:
- Google News / web search for niche keywords from profile.md
- Check if any major announcements, product launches, industry shifts happened
- Look at trending discussions on the target platforms
- Check competitor accounts if listed in profile.md

Goal: 3-5 real, current, specific things happening in the world.

### Step 2 — Personal Experience Mining

Read the user's recent activity for real stories:
- **Daily logs** (`rachel-memory/daily-logs/`) — what did the user do with Rachel recently?
- **CRM contacts** — any new connections, meetings, follow-ups worth mentioning?
- **Projects built** — landing pages, documents, research Rachel helped with
- **Ideas backlog** (`social-media/ideas/`) — anything saved for later?
- **User-sent assets** (`social-media/assets/`) — photos, screenshots waiting to be used

Goal: 3-5 real things from the user's actual life/work.

### Step 3 — The Combination Matrix

This is the anti-slop engine. Every post needs TWO halves:

```
[What happened in the world]  ×  [What the user did/knows]  =  Post idea
```

Examples:
- "OpenAI launched new agents" × "User enriched 50 contacts via screenshots" → "Everyone's building AI agents. I enriched 50 contacts from LinkedIn screenshots without a single API call. Sometimes the best agent is the simplest one."
- "LinkedIn changed their algorithm" × "User's last post got low reach" → "LinkedIn killed my reach last week. Here's what I'm changing: [specific strategy]"
- "Networking event happened in the industry" × "User has a conference next week" → "I'm heading to [event] next week. Last time I met 12 people and followed up with zero. This time my AI assistant is handling follow-ups automatically."

News alone = generic commentary (slop).
Personal experience alone = navel-gazing.
The combination = genuine insight.

If no good combinations exist, fall back to:
- Pure personal experience posts (still valuable if specific)
- Ask the user: "Nothing great trending this week. What's on your mind? Any wins, frustrations, or observations?"

### Step 4 — Write Drafts

For each of the top 3 ideas, write platform-specific drafts:

**LinkedIn:**
- 1200-1800 characters (not too long, not too short)
- Hook in the first line (this shows in the preview — make it count)
- Short paragraphs, line breaks between them
- Personal storytelling tone
- Soft CTA at the end (question to drive comments)
- 3-5 hashtags at the very end, separated from the post
- NO emoji spam (1-2 max, only if natural)

**X (Twitter):**
- Single tweet (280 chars) OR thread (3-5 tweets)
- Punchy, conversational, slightly provocative
- First tweet must stand alone and hook
- Thread tweets should each add value independently
- No hashtags in the tweet body (looks spammy on X), maybe 1-2 at end
- Contrarian takes perform well

**Threads:**
- Casual, conversational, like talking to a friend
- Shorter than LinkedIn, longer than X
- More personal/vulnerable tone works well here
- Can reference Instagram-native culture
- Light on hashtags

ALWAYS reference `profile.md` voice samples when writing. Match the user's actual tone, vocabulary, sentence structure.

### Step 5 — Propose to User

Send the proposals as a single message with clear structure:

```
Here are 3 post ideas for this week:

1. [one-line summary of the idea]
   Why: [the seed — what news + what personal experience]

   LinkedIn draft:
   [full draft]

   X draft:
   [full draft]

2. [next idea...]

Which ones do you like? I can adjust tone, length, angle — or if none of these hit, tell me what's on your mind and I'll write around that.
```

### Step 6 — Refine & Finalize

When the user responds:
- "Post this" / "This is good" → save to history, note as posted
- "Make it shorter / punchier / more personal" → rewrite accordingly
- "I don't like any, here's my idea: ..." → write around their seed instead
- "Save for later" → move to `ideas/`
- "Add this photo" → user sends image, Rachel integrates it into the post concept

## Proactive Content Coaching

This is a FIRST-CLASS feature, not a side note. Rachel actively coaches the user to capture content-worthy moments.

### When to Nudge

Rachel should send proactive content coaching messages when she detects opportunities:

**Before events/meetings (from CRM):**
- "You're meeting [name] at [event] tomorrow. If something interesting comes up, snap a photo — it could make a great post about [topic]."
- "You have 3 meetings this week. A 'week in review' post with a behind-the-scenes photo always performs well."
- "You're heading to [conference]. Take a photo at the venue, one with a speaker, and one of your badge — that's 3 posts right there."

**After CRM activity:**
- "You just connected with 5 new people in [industry]. A post about your networking approach could resonate — want me to draft one?"
- "You enriched [name]'s profile from a LinkedIn screenshot. That workflow is interesting — a 'how I manage 500 contacts' post could work well."

**After building something with Rachel:**
- "You just built a landing page in 2 minutes. Screenshot it before we move on — perfect for a 'look what AI can do' post."
- "You just imported 200 contacts from a WhatsApp group. That's impressive — worth a post about automation."
- "I just helped you draft 10 outreach emails. The before/after story (manual vs AI) is great content."

**Based on content gaps:**
- "You haven't posted in 8 days. Want me to put together something quick from this week's activity?"
- "Your last 3 posts were all tips. Time for a personal story — anything happen this week worth sharing?"

### How to Implement Coaching Nudges

Coaching nudges are triggered by:
1. **CRM follow-up agent tasks** — when a follow-up fires and it involves a meeting/event, add the photo coaching
2. **Content schedule agent tasks** — each content cycle checks CRM for upcoming events and includes coaching
3. **Standalone coaching tasks** — schedule a daily or 2x-weekly "content coaching check" agent task:

```bash
sqlite3 $SHARED_FOLDER_PATH/rachel-memory/tasks.db "INSERT INTO tasks (name, type, schedule, data, next_run) VALUES (
  'content-coaching-check',
  'agent',
  '0 8 * * *',
  '{\"prompt\":\"Content coaching check. Read CRM contacts for upcoming meetings/events in the next 48 hours. Read recent daily logs for content-worthy moments the user might not have noticed. If there is a clear opportunity (event, achievement, milestone), send a short coaching nudge to the user suggesting they capture a photo, screenshot, or story. Keep it brief and natural — one message, 2-3 sentences max. If nothing stands out today, do nothing (do NOT send a message just because the task fired). Follow the social-media skill coaching guidelines.\"}',
  $(date -d 'tomorrow 08:00' +%s)000
);"
```

### Coaching Rules

1. **Don't be annoying** — max 1 coaching nudge per day. If nothing stands out, stay silent.
2. **Be specific** — "Take a photo at the conference" is good. "You should create content" is useless.
3. **Suggest the format** — "A selfie with [person] + a paragraph about what you discussed = great LinkedIn post"
4. **Tie to the user's goals** — reference their niche/audience from profile.md
5. **Accept images proactively** — when the user sends a photo, immediately suggest post angles: "Great shot! I can turn this into: A) a LinkedIn post about [angle], B) an X thread about [angle]. Which one?"

## User-Sent Assets

When the user sends photos, screenshots, or any media that could be content:

1. Save to `social-media/assets/` with a descriptive name
2. Immediately propose 2-3 post angles that use the image
3. Ask which platform(s) they want to post on
4. Write drafts that reference the image naturally (not "check out this photo!" but weave it into the story)

For platforms that support images (all three), the post should be written TO ACCOMPANY the image — the text and image should tell a story together.

## Anti-Slop Rules

These are NON-NEGOTIABLE:

1. **Every post needs a real seed** — something that actually happened (news, personal experience, or both). No generating from thin air.
2. **Write in the user's voice** — always reference profile.md style samples. Match their vocabulary, sentence length, humor level, emoji usage.
3. **Ban generic language** — never use: "game-changer", "let that sink in", "here's the thing", "unpopular opinion" (unless the user actually talks like that), "I'm excited to announce", "hustle/grind", "10x", "level up"
4. **Specific > vague** — "I enriched 50 contacts from screenshots" beats "AI is transforming sales". Numbers, names (with permission), real details.
5. **Contrarian > agreeable** — "Everyone's doing X, here's why I do Y" beats "X is great and here's why"
6. **Story > advice** — "Last week I tried X and here's what happened" beats "5 tips for better networking"
7. **Short paragraphs** — never more than 2-3 lines per paragraph. White space is your friend.
8. **One idea per post** — don't cram multiple topics. Each post has one clear takeaway.
9. **No emoji spam** — 0-2 per post max unless the user's style uses more
10. **The "would a human write this?" test** — read the draft and honestly ask: does this sound like a real person or like ChatGPT? If the latter, rewrite.

## Content History

Every post that the user approves and posts should be logged:

```markdown
---
date: 2026-02-22T10:00:00Z
platform: linkedin
seed_news: "OpenAI launched new agent framework"
seed_personal: "Built screenshot-based CRM enrichment"
status: posted
---

Everyone's talking about AI agents this week.

Meanwhile, I enriched 50 contacts by sending LinkedIn screenshots to my AI assistant on Telegram. No API. No login. No credits.

Sometimes the best agent is the one that does the simple thing really well.

What's the most surprisingly simple AI workflow you've found?

#AI #Sales #CRM #Networking
```

Before generating new content, always check `history/` from the last 2 weeks to avoid repeating themes or angles.

## profile.md Template

```markdown
---
platforms: [linkedin, x, threads]
niche: [AI assistants, sales automation, CRM, networking]
audience: Salespeople, networkers, small business owners
goals: [thought-leadership, lead-generation]
posting_frequency: "2x per week"
schedule_days: [monday, thursday]
schedule_time: "09:00 CET"
competitors: []
---

## Voice & Style

[Analyzed from user's sample posts]

- Tone: casual-professional, direct, slightly irreverent
- Length preference: medium (LinkedIn 1200-1500 chars, X threads 3-4 tweets)
- Emoji usage: minimal (0-1 per post)
- Humor: dry, observational
- Storytelling: leads with the outcome, then explains how
- Avoids: corporate jargon, motivational cliches

## Sample Posts

### Sample 1
[paste or link to a post the user liked]

### Sample 2
[paste or link]

### Sample 3
[paste or link]

## Topics I Know Well
- Building AI assistants
- Managing contacts / networking
- Sales automation
- [added over time as user creates content]

## Topics to Avoid
- [anything the user says they don't want to post about]
```

## Integration with CRM Skill

The social media skill reads CRM data but does NOT write to it. The connection points:

- **Upcoming meetings** → content coaching ("take a photo")
- **New connections** → post ideas ("just met 5 people in AI")
- **Follow-up activity** → post seeds ("how I manage follow-ups")
- **Enrichment events** → post seeds ("screenshot enrichment workflow")
- **Conference/event contacts** → before/after content opportunities

## Platform-Specific Formatting

### LinkedIn
```
Hook line that appears in preview (make it compelling)

Short paragraph with the story or insight.

Another short paragraph building on it.

Key takeaway or personal reflection.

Soft CTA question to drive comments?

#Hashtag1 #Hashtag2 #Hashtag3
```

### X (Single Tweet)
```
[Sharp take or observation in 280 chars. Personality > polish.]
```

### X (Thread)
```
1/ Hook tweet — must stand alone and make people click "Show more"

2/ Context or setup — the background

3/ The insight or story — the meat

4/ Takeaway — what to do with this

5/ CTA — question, invitation to share, or link
```

### Threads
```
Casual opener, like you're telling a friend

The story or observation, kept conversational

Maybe a self-deprecating joke or honest admission

One clear point, no corporate nonsense
```

## Important Rules

1. NEVER auto-post without explicit user approval
2. NEVER generate content without a real seed (news + experience)
3. ALWAYS check content history before proposing (no repeats within 2 weeks)
4. ALWAYS write in the user's voice from profile.md
5. ALWAYS explain the reasoning (the seed) behind each proposal
6. MAX 1 coaching nudge per day — if nothing stands out, stay silent
7. When user sends a photo/screenshot, immediately propose post angles
8. Save all approved posts to history with metadata
9. Proactive coaching is a core feature — integrate with CRM calendar
10. The combination matrix (world × personal) is the primary content engine
