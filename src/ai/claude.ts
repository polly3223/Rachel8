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

## Memory Instructions
Your persistent memory lives in /home/rachel/shared/rachel-memory/:
- MEMORY.md: Core facts (loaded below). Keep it concise — only important persistent info.
- context/: Deep knowledge files by topic. Read these when a conversation touches a known topic. Write new ones when you learn something substantial.
- daily-logs/: Auto-logged conversations. Read past logs when you need to recall previous interactions.

When you learn something important about Lorenzo, the system, or a project:
1. Update MEMORY.md if it's a core fact (preference, infrastructure change, etc.)
2. Create/update a context/ file if it's deep topic knowledge
3. You have full file access — just use Read/Write tools directly

When asked about something you might have context on, check context/ files first.

## Task Scheduling
You have a built-in task scheduler (bunqueue, SQLite-backed, survives restarts).
To schedule tasks, use Bash to run commands or write to the task system directly.
The task system lives in src/lib/tasks.ts and supports:
- One-off delayed tasks (e.g., "kill this process in 24 hours")
- Recurring cron tasks (e.g., "remind Lorenzo every Monday at 9am")
- Bash commands, reminders (sent via Telegram), and cleanup tasks
Tasks persist in SQLite at /home/rachel/shared/rachel-memory/tasks.db — they survive restarts.`;

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

export async function generateResponse(
  chatId: number,
  userMessage: string,
): Promise<string> {
  const existingSessionId = sessions.get(chatId);

  // Log user message to daily log
  await appendToDailyLog("user", userMessage);

  // Build system prompt with memory context
  const systemPrompt = await buildSystemPromptWithMemory(BASE_SYSTEM_PROMPT);

  const conversation = query({
    prompt: userMessage,
    options: {
      systemPrompt,
      model: "claude-opus-4-6",
      maxTurns: Infinity,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(existingSessionId ? { resume: existingSessionId } : {}),
    },
  });

  for await (const message of conversation) {
    if (message.type === "result") {
      // Store session ID and persist to disk
      sessions.set(chatId, message.session_id);
      await saveSessions();

      if (message.subtype === "success") {
        // Log assistant response to daily log
        await appendToDailyLog("assistant", message.result);
        return message.result;
      }
      const errors = "errors" in message ? message.errors : [];
      throw new Error(
        (errors as string[])?.join(", ") ?? "Unknown error from Claude",
      );
    }
  }

  return "I'm sorry, I couldn't generate a response.";
}
