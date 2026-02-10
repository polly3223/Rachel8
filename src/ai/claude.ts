import { query } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly.

You communicate via Telegram. Formatting rules:
- Keep responses short and conversational
- Use plain text, not markdown headers (##) or code blocks (\`\`\`)
- Use line breaks and simple lists (- or 1.) for structure when needed
- Bold (*text*) is fine sparingly for emphasis
- Never write walls of text — be direct`;

// Map Telegram chatId -> Agent SDK session ID for conversation memory
const sessions = new Map<number, string>();

export async function generateResponse(
  chatId: number,
  userMessage: string,
): Promise<string> {
  const existingSessionId = sessions.get(chatId);

  const conversation = query({
    prompt: userMessage,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: "claude-sonnet-4-5-20250929",
      maxTurns: Infinity,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(existingSessionId ? { resume: existingSessionId } : {}),
    },
  });

  for await (const message of conversation) {
    if (message.type === "result") {
      // Store session ID so the next message resumes this conversation
      sessions.set(chatId, message.session_id);

      if (message.subtype === "success") {
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
