import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../lib/logger.ts";
import { appendToDailyLog, buildSystemPromptWithMemory } from "../lib/memory.ts";

const BASE_SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly.

You communicate via Telegram. Formatting rules:
- Keep responses short and conversational
- Use plain text, not markdown headers (##) or code blocks (\`\`\`)
- Use line breaks and simple lists (- or 1.) for structure when needed
- Bold (*text*) is fine sparingly for emphasis
- Never write walls of text — be direct

## Tool & Runtime Defaults
- For Python projects and scripts, always use UV for package management and virtual environments (not pip/venv directly)
- For JavaScript/TypeScript, always use Bun (not npm/node) unless Lorenzo specifies otherwise
- You have skills installed in the skills/ directory — use them when relevant (PDF, Excel, Word, PowerPoint, web design, MCP servers, etc.)

## Memory Instructions
Your persistent memory lives in /home/rachel/shared/rachel-memory/:
- MEMORY.md: Core facts (loaded below). Keep it concise — only important persistent info.
- context/: Deep knowledge files by topic. Read these when a conversation touches a known topic. Write new ones when you learn something substantial.
- daily-logs/: Auto-logged conversations. Read past logs when you need to recall previous interactions.

IMPORTANT — Memory is YOUR responsibility. You MUST proactively save important information as you learn it, without being asked. Do NOT wait for Lorenzo to remind you. After every conversation where you learn something new, update memory immediately:
1. Update MEMORY.md if it's a core fact (preference, personal info, infrastructure change, etc.)
2. Create/update a context/ file if it's deep topic knowledge (project details, research findings, technical decisions)
3. You have full file access — just use Read/Write tools directly

Examples of things to always save:
- Personal facts about Lorenzo (family, work, preferences, feelings)
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
- Recurring cron tasks (e.g., "remind Lorenzo every Monday at 9am")
- Bash commands, reminders (sent via Telegram), cleanup tasks, and *agent* tasks
- Agent tasks (type: "agent") trigger you autonomously with a prompt — you execute with full tool access and send results to Lorenzo
- Use agent tasks when the scheduled work requires AI reasoning (building things, research, complex multi-step work)
- Use reminder tasks for simple text notifications
Tasks persist in SQLite at /home/rachel/shared/rachel-memory/tasks.db — they survive restarts.

## Self-Management
- To restart yourself: sudo systemctl restart rachel8
- To check your status: sudo systemctl status rachel8
- To view logs: sudo journalctl -u rachel8 -f
- Your repo is at /home/rachel/rachel8 — after code changes, commit, push, and restart.
- IMPORTANT: When restarting, ALWAYS send your final reply first, then wait ~60 seconds before restarting so the message is delivered to Telegram.`;

const SESSIONS_FILE = `${import.meta.dir}/../../.sessions.json`;

// Map Telegram chatId -> Agent SDK session ID for conversation memory
const sessions = new Map<number, string>();

// Load persisted sessions from disk on startup
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

// Load sessions immediately
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
      model: "claude-opus-4-6",
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isContextOverflow =
      errorMsg.toLowerCase().includes("prompt is too long") ||
      errorMsg.toLowerCase().includes("too many tokens") ||
      errorMsg.toLowerCase().includes("context length") ||
      errorMsg.toLowerCase().includes("max_tokens") ||
      errorMsg.toLowerCase().includes("request too large");

    if (isContextOverflow && existingSessionId) {
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
          error: retryError,
        });
        throw retryError;
      }
    }

    throw error;
  }
}
