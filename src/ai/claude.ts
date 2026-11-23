import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunTurn } from "./turn.ts";

export const runClaude: RunTurn = async (options) => {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  options.signal.throwIfAborted();
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    const mcpServers = options.mcpServers?.length
      ? Object.fromEntries(
          options.mcpServers.map((s) => [
            s.name,
            {
              command: s.command,
              args: s.args,
              ...(Object.keys(s.env).length ? { env: s.env } : {}),
            },
          ]),
        )
      : undefined;
    for await (const message of query({
      prompt: options.input.text,
      options: {
        systemPrompt: options.instructions,
        model: Bun.env["CLAUDE_MODEL"] || "claude-opus-4-6",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
        ...(mcpServers ? { mcpServers } : {}),
        ...(options.sessionId ? { resume: options.sessionId } : {}),
      },
    })) {
      if ("session_id" in message && typeof message.session_id === "string")
        options.onSession(message.session_id);
      if (message.type === "result") {
        if (message.subtype === "success") return { text: message.result };
        throw new Error("errors" in message ? message.errors.join(", ") : "Claude turn failed");
      }
    }
    throw new Error("No result received from Claude");
  } finally {
    options.signal.removeEventListener("abort", abort);
  }
};
