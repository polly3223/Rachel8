import type { AIProvider } from "../ai/provider.ts";
import { REASONING_EFFORTS, type ReasoningEffort } from "../lib/reasoning-effort.ts";

const EFFORT_DESCRIPTIONS: Record<ReasoningEffort, string> = {
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation",
};

export const EFFORT_SET_COMMANDS = REASONING_EFFORTS.map((effort) => ({
  command: `effort_${effort}`,
  description: EFFORT_DESCRIPTIONS[effort],
  effort,
}));

function effortCommandsForProvider(provider?: AIProvider) {
  return provider === "antigravity"
    ? EFFORT_SET_COMMANDS.filter(({ effort }) => effort !== "max" && effort !== "ultra")
    : EFFORT_SET_COMMANDS;
}

export function botCommandsForProvider(provider?: AIProvider) {
  return [
    { command: "help", description: "Explain all commands" },
    { command: "refresh", description: "Save context and start a fresh thread" },
    { command: "effort", description: "Show current thinking effort" },
    ...effortCommandsForProvider(provider).map(({ command, description }) => ({
      command,
      description,
    })),
  ];
}

export const BOT_COMMANDS = botCommandsForProvider();

export function buildHelpText(provider?: AIProvider): string {
  const effortCommands = effortCommandsForProvider(provider);
  return [
    "Rachel commands",
    "",
    "/start - Start Rachel.",
    "/help - Show this guide.",
    "/status - Show active work and recent results.",
    "/workers - Show the persistent worker roster and review status.",
    "/stop [work ID] - Stop this chat or a selected job; cancel queued chat requests.",
    "/resume <work ID> - Recover interrupted work after checking completed actions.",
    "/answer <text> - Answer a question from an active task.",
    "/retry_delivery <work ID> - Retry sending a saved result without rerunning it.",
    "/capabilities - Discover configured connectors and tool availability.",
    "Messages sent during a Codex or Antigravity task steer it. Other providers queue them.",
    "/refresh - Save the active work, start a fresh AI thread, and load the handoff.",
    "",
    "AI provider login",
    "/login [codex|claudecode|antigravity] - Sign in. Without an argument, uses the configured provider.",
    "/login_status [codex|claudecode|antigravity] - Check sign-in status.",
    "/login_code <code> - Submit a code when Claude or Antigravity asks for one.",
    "/login_cancel - Cancel an active provider login.",
    "",
    "MCP connectors (provider-agnostic)",
    "Direct Model Context Protocol (MCP) connectors (linear, atlassian, attio, posthog) and Fluso Cloud (for Gmail, Slack, Google Workspace, etc.) work across Antigravity, Codex and Claude Code.",
    "/connector_connect <name> [https://url | fluso-token] - Connect a direct MCP preset, custom Streamable HTTP MCP, or Fluso.",
    "/connector_status [name] - Check connector auth status.",
    "/connector_callback <URL> - Complete OAuth authorization by pasting the redirected localhost callback URL.",
    "/connector_cancel [name] - Cancel a pending connector authorization.",
    "",
    "Thinking effort",
    "/effort - Show the current persistent effort.",
    ...effortCommands.map(
      ({ command, description }) =>
        `/${command} - ${description}. Applies from the next turn.`,
    ),
  ].join("\n");
}
