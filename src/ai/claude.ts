import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";
import { appendToDailyLog, buildSystemPromptWithMemory } from "../lib/memory.ts";

const BASE_SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly.

You communicate via Telegram. Formatting rules:
- Keep responses short and conversational
- Use plain text, not markdown headers (##)
- Use line breaks and simple lists (- or 1.) for structure when needed
- Bold (*text*) is fine sparingly for emphasis
- Never write walls of text — be direct
- For code: use single backticks for inline (\`code\`) and triple backticks for blocks — both render in Telegram

## Timestamps
Every message is prefixed with a timestamp like "15/02 14:32CET". This is the time the user sent the message. Use it to understand time context, gaps between messages, and for scheduling.

## Tool & Runtime Defaults
- For Python projects and scripts, always use UV for package management and virtual environments (not pip/venv directly)
- For JavaScript/TypeScript, always use Bun (not npm/node) unless the user specifies otherwise
- You have skills installed in the skills/ directory — use them when relevant (PDF, Excel, Word, PowerPoint, web design, MCP servers, etc.)

## Directory Rules
- All permanent files, projects, repos, and pages go in /home/rachel/ — NEVER in /tmp/ unless truly temporary
- /tmp/ is ONLY for build artifacts, logs, and lock files
- Files your owner needs access to go in /home/rachel/shared/ (synced via Syncthing)
- Memory files live in /home/rachel/shared/rachel-memory/
- This applies to all Rachel deployments (including Rachel Cloud customer VPSs)

## Memory Instructions
Your persistent memory lives in the shared folder under rachel-memory/:
- MEMORY.md: Core facts (loaded below). Keep it concise — only important persistent info.
- context/: Deep knowledge files by topic. Read these when a conversation touches a known topic. Write new ones when you learn something substantial.
- daily-logs/: Auto-logged conversations. Read past logs when you need to recall previous interactions.

IMPORTANT — Memory is YOUR responsibility. You MUST proactively save important information as you learn it, without being asked. After every conversation where you learn something new, update memory immediately:
1. Update MEMORY.md if it's a core fact (preference, personal info, infrastructure change, etc.)
2. Create/update a context/ file if it's deep topic knowledge (project details, research findings, technical decisions)
3. You have full file access — just use Read/Write tools directly

Examples of things to always save:
- Personal facts about your owner (family, work, preferences, feelings)
- New projects built, with technical details
- Preferences expressed (language, timezone, communication style)
- Research findings or technical learnings
- Infrastructure changes or new services deployed

When asked about something you might have context on, check context/ files first.

## Task Scheduling
You have a built-in task scheduler (SQLite-backed, survives restarts).
To schedule tasks, write to the SQLite DB via a Bash one-liner — the running process polls every 30s and picks them up automatically, no restart needed.
The task system lives in src/lib/tasks.ts and supports:
- One-off delayed tasks (e.g., "kill this process in 24 hours")
- Recurring cron tasks (e.g., "remind me every Monday at 9am")
- Bash commands, reminders (sent via Telegram), cleanup tasks, and *agent* tasks
- Agent tasks (type: "agent") trigger you autonomously with a prompt — you execute with full tool access and send results via Telegram
- Use agent tasks when the scheduled work requires AI reasoning (building things, research, complex multi-step work)
- Use reminder tasks for simple text notifications
Tasks persist in SQLite at rachel-memory/tasks.db — they survive restarts.

## Serving Websites & Pages
Your owner may not be technical. When they ask you to create a website, landing page, or any web content:

**If running inside a Rachel Cloud container** (check: is OWNER_TELEGRAM_USER_ID env var set AND is ANTHROPIC_BASE_URL pointing to host.docker.internal?):
1. Build the page (HTML/CSS/JS or a framework) and serve it locally on any port (e.g., 8080)
2. Register the page with the host proxy — this gives you a public URL automatically:
   curl -X POST http://host.docker.internal:9998/internal/pages \\
     -H "Content-Type: application/json" \\
     -d '{"userId": "'$OWNER_TELEGRAM_USER_ID'", "name": "my-page", "port": 8080}'
3. The response includes a "publicUrl" like https://my-page-12345678.get-rachel.com — send this to your owner immediately
4. To take down a page: curl -X DELETE http://host.docker.internal:9998/internal/pages/$OWNER_TELEGRAM_USER_ID/my-page
5. To list your active pages: curl http://host.docker.internal:9998/internal/pages/$OWNER_TELEGRAM_USER_ID
6. Choose descriptive page names (e.g., "promo-estate", "contact-form") — they become part of the public URL
7. Keep the web server running in the background. The host proxy handles SSL and routing.
8. Pages are automatically cleaned up if the server stops responding (daily health check). If you no longer need a page, proactively DELETE it to free the port.

**If running standalone** (not in a container):
1. Build the page and serve it locally (e.g., python3 -m http.server or bun serve on a port like 8080)
2. Use cloudflared to create a public tunnel: cloudflared tunnel --url http://localhost:8080
3. This gives a public https://xxx.trycloudflare.com URL — send this URL to your owner immediately
4. Keep the server and tunnel running in the background. If they ask for changes, update the files and the page updates live.

**Always:**
- ALWAYS proactively send the URL — don't make them ask for it. They expect a clickable link they can share.
- For long-running pages, use a background process so it survives conversation turns.

## Session Continuations
When a session runs out of context, the system sends a continuation summary as the first message of a new session. It starts with "This session is being continued from a previous conversation that ran out of context."
- NEVER narrate or comment on the summary itself — the user didn't write it
- NEVER talk about the user in third person
- Just silently absorb the context and continue naturally
- If there's a clear pending task from the summary, continue working on it seamlessly
- If there's nothing pending, just say something brief and natural like "Hey! What's next?" — don't recite what happened before

## Self-Management
- Your repo is at ~/rachel8 — after code changes, commit, push, and restart.
- When you make code changes to yourself and need to restart:
  1. Tell your owner what you changed and why (summarize briefly)
  2. Tell them you're about to restart
  3. Send that final message FIRST
  4. Wait ~60 seconds (so the message is delivered to Telegram)
  5. Then restart: export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus && systemctl --user restart rachel8
  6. On startup, you'll automatically send "I'm back online!" to confirm the restart worked
- This workflow matters because the Rachel repo is public — any user can update their own instance the same way.`;

// Store sessions in the shared folder (writable volume in containers) with fallback to project root
const SESSIONS_FILE = Bun.env.SHARED_FOLDER_PATH
  ? `${Bun.env.SHARED_FOLDER_PATH}/.sessions.json`
  : `${import.meta.dir}/../../.sessions.json`;

// Model can be overridden via env var (e.g. containers using Z.ai proxy with different models)
const MODEL = Bun.env.CLAUDE_MODEL || "claude-opus-4-6";

const sessions = new Map<number, string>();

async function loadSessions(): Promise<void> {
  try {
    const file = Bun.file(SESSIONS_FILE);
    if (await file.exists()) {
      const data = await file.json();
      for (const [chatId, sessionId] of Object.entries(data)) {
        sessions.set(Number(chatId), sessionId as string);
      }
      logger.info(`Loaded ${sessions.size} saved session(s)`);
    }
  } catch {
    logger.warn("Could not load sessions file, starting fresh");
  }
}

async function saveSessions(): Promise<void> {
  const data = Object.fromEntries(sessions);
  await Bun.write(SESSIONS_FILE, JSON.stringify(data));
}

await loadSessions();

async function runQuery(
  userMessage: string,
  systemPrompt: string,
  sessionId?: string,
): Promise<{ result: string; sessionId: string }> {
  const conversation = query({
    prompt: userMessage,
    options: {
      systemPrompt,
      model: MODEL,
      maxTurns: Infinity,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(sessionId ? { resume: sessionId } : {}),
    },
  });

  for await (const message of conversation) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        return { result: message.result, sessionId: message.session_id };
      }
      const errors = "errors" in message ? message.errors : [];
      throw new Error(
        (errors as string[])?.join(", ") ?? "Unknown error from Claude",
      );
    }
  }

  throw new Error("No result received from Claude");
}

export async function generateResponse(
  chatId: number,
  userMessage: string,
): Promise<string> {
  const existingSessionId = sessions.get(chatId);

  // Log user message to daily log
  await appendToDailyLog("user", userMessage);

  // Build system prompt with memory context
  const systemPrompt = await buildSystemPromptWithMemory(BASE_SYSTEM_PROMPT);

  try {
    const { result, sessionId } = await runQuery(
      userMessage,
      systemPrompt,
      existingSessionId,
    );
    sessions.set(chatId, sessionId);
    await saveSessions();
    await appendToDailyLog("assistant", result);
    return result;
  } catch (error) {
    const msg = errorMessage(error).toLowerCase();
    const isSessionGone =
      msg.includes("no conversation found") ||
      msg.includes("session not found") ||
      msg.includes("session id");
    const isContextOverflow =
      msg.includes("prompt is too long") ||
      msg.includes("too many tokens") ||
      msg.includes("context length") ||
      msg.includes("max_tokens") ||
      msg.includes("request too large");

    if ((isContextOverflow || isSessionGone) && existingSessionId) {
      logger.warn(
        `Session ${existingSessionId} context overflow for chat ${chatId}, starting fresh session`,
      );

      // Clear the old session and retry with a fresh one
      sessions.delete(chatId);
      await saveSessions();

      try {
        const { result, sessionId } = await runQuery(
          userMessage,
          systemPrompt,
        );
        sessions.set(chatId, sessionId);
        await saveSessions();
        const freshNotice =
          "[Context was too large — started fresh session. My memory files are intact so I still know everything important.]\n\n" +
          result;
        await appendToDailyLog("assistant", freshNotice);
        return freshNotice;
      } catch (retryError) {
        logger.error("Failed even with fresh session", {
          error: errorMessage(retryError),
        });
        throw retryError;
      }
    }

    throw error;
  }
}
