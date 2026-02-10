import { query } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly. You communicate via Telegram, so keep responses reasonably brief unless asked for detail.`;

export async function generateResponse(userMessage: string): Promise<string> {
  const conversation = query({
    prompt: userMessage,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: "claude-sonnet-4-5-20250929",
      maxTurns: 1,
      allowedTools: [],
    },
  });

  for await (const message of conversation) {
    if (message.type === "result") {
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
