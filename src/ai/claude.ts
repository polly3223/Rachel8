import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.ts";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Rachel, a personal AI assistant. You are helpful, concise, and friendly. You communicate via Telegram, so keep responses reasonably brief unless asked for detail.`;

export async function generateResponse(userMessage: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock?.text ?? "I'm sorry, I couldn't generate a response.";
}
