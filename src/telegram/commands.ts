import { REASONING_EFFORTS, type ReasoningEffort } from "../lib/reasoning-effort.ts";

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "extra high",
  max: "max",
  ultra: "ultra",
};

export const EFFORT_SET_COMMANDS = REASONING_EFFORTS.map((effort) => ({
  command: `effort_${effort}`,
  description: `Set thinking effort to ${EFFORT_LABELS[effort]}`,
  effort,
}));

export const BOT_COMMANDS = [
  { command: "help", description: "Explain all commands" },
  { command: "refresh", description: "Save context and start a fresh thread" },
  { command: "effort", description: "Show current thinking effort" },
  ...EFFORT_SET_COMMANDS.map(({ command, description }) => ({ command, description })),
];

export function buildHelpText(): string {
  return [
    "Rachel commands",
    "",
    "/start - Start Rachel.",
    "/help - Show this guide.",
    "/status - Show active work and recent results.",
    "/stop [work ID] - Stop this chat or a selected job; cancel queued chat requests.",
    "/resume <work ID> - Recover interrupted work after checking completed actions.",
    "/answer <text> - Answer a question from an active task.",
    "/retry_delivery <work ID> - Retry sending a saved result without rerunning it.",
    "/capabilities - Discover configured connectors and tool availability.",
    "Messages sent during a Codex task steer it. Other providers queue them.",
    "/refresh - Save the active work, start a fresh AI thread, and load the handoff.",
    "",
    "AI provider login",
    "/login [codex|claudecode] - Sign in. Without an argument, uses the configured provider.",
    "/login_status [codex|claudecode] - Check sign-in status.",
    "/login_code <code> - Submit a code when Claude asks for one.",
    "/login_cancel - Cancel an active provider login.",
    "",
    "MCP connectors",
    "Connectors let Rachel use Slack or Linear through the Model Context Protocol (MCP). After connecting, ask Rachel naturally to read or work with them.",
    "/connector_connect <linear|slack> - Install the connector if needed and start authorization.",
    "/connector_status [linear|slack] - Check one connector or both.",
    "/connector_callback <URL> - Complete Linear authorization if its localhost page does not open; send the complete browser address.",
    "/connector_cancel - Cancel an active connector authorization.",
    "",
    "Thinking effort",
    "/effort - Show the current persistent effort.",
    ...EFFORT_SET_COMMANDS.map(
      ({ command, effort }) =>
        `/${command} - Set effort to ${EFFORT_LABELS[effort]}. Applies from the next turn.`,
    ),
  ].join("\n");
}
