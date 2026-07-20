import { REASONING_EFFORTS } from "../lib/reasoning-effort.ts";

export const BOT_COMMANDS = [
  { command: "start", description: "Start Rachel" },
  { command: "help", description: "Explain all commands" },
  { command: "login", description: "Sign in to an AI provider" },
  { command: "login_code", description: "Complete Claude sign-in" },
  { command: "login_cancel", description: "Cancel provider sign-in" },
  { command: "login_status", description: "Check provider sign-in" },
  { command: "connector_connect", description: "Connect Slack or Linear" },
  { command: "connector_callback", description: "Complete Linear authorization" },
  { command: "connector_cancel", description: "Cancel connector authorization" },
  { command: "connector_status", description: "Check Slack and Linear" },
  { command: "effort", description: "View or change thinking effort" },
] as const;

export function buildHelpText(): string {
  return [
    "Rachel commands",
    "",
    "/start - Start Rachel.",
    "/help - Show this guide.",
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
    "/effort <level> - Change it from the next turn until changed again.",
    `Valid levels: ${REASONING_EFFORTS.join(", ")}`,
  ].join("\n");
}
