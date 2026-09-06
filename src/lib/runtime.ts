import { getStore } from "../ai/session-store.ts";
import { generate, refreshConversationContext, shutdownAI } from "../ai/index.ts";
import { buildInput, incomingFor, releaseIncoming } from "../telegram/handlers/message.ts";
import { sendArtifact, sendChunks, sendText, telegram } from "../telegram/delivery.ts";
import { WorkRunner, executeShellTask } from "./tasks.ts";
import { env } from "../config/env.ts";
import type { Task } from "./work-store.ts";

let runner: WorkRunner | undefined;
export function startRuntime(): void {
  const store = getStore();
  runner = new WorkRunner(store, {
    owner: env.OWNER_TELEGRAM_USER_ID,
    send: (item) =>
      item.path ? sendArtifact(item.chat, item.path) : sendText(item.chat, item.text ?? ""),
    execute: async (run, signal) => {
      let typing: ReturnType<typeof setInterval> | undefined;
      try {
        const body = JSON.parse(run.body) as Task & { resumeOf?: number };
        if (run.kind === "task") {
          const shell = await executeShellTask(body, signal);
          if (shell) return shell;
        }
        const incoming = run.kind === "telegram" ? incomingFor(run.id, run.body) : undefined;
        if (incoming?.refresh) {
          await refreshConversationContext(run.key, { signal, runId: run.id });
          return { text: "Fresh context loaded — ready and light again." };
        }
        const input = incoming
          ? await buildInput(incoming, signal)
          : { text: (JSON.parse(body.data) as { prompt: string }).prompt };
        const previousId = incoming?.resumeOf ?? body.resumeOf;
        if (previousId) {
          const previous = store.get(previousId);
          input.text = `Resume interrupted work #${previousId}. Inspect the current project state and completed actions before continuing; do not repeat sends, deployments or other effects already completed.\nSaved checkpoint (context):\n${previous?.checkpoint ?? "None"}\n\nOriginal request:\n${input.text}`;
        }
        const chat = run.kind === "telegram" ? Number(run.key) : undefined;
        let lastProgress = 0;
        typing = chat
          ? setInterval(() => {
              void telegram.sendChatAction(chat, "typing").catch(() => {});
            }, 4500)
          : undefined;
        return await generate(run.key, input, {
          runId: run.id,
          signal,
          onProgress: chat
            ? async (text) => {
                if (Date.now() - lastProgress < 5000) return;
                lastProgress = Date.now();
                await sendChunks(chat, text).catch(() => {});
              }
            : undefined,
          onQuestion: chat
            ? async (text, choices) => {
                await sendChunks(
                  chat,
                  `${text}${choices.length ? `\n${choices.map((c) => `- ${c}`).join("\n")}` : ""}\n\nReply with /answer followed by your answer.`,
                );
              }
            : undefined,
        });
      } finally {
        clearInterval(typing);
        releaseIncoming(run.id);
      }
    },
  });
  runner.start();
}
export function stopWork(id: number): void {
  const run = getStore().get(id);
  if (!run || !["queued", "running", "steering"].includes(run.state))
    throw new Error("That work is not active or queued");
  runner?.stop(id);
}
export async function shutdownRuntime(): Promise<void> {
  shutdownAI();
  await runner?.shutdown();
}
