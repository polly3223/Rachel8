export const BOT_COMMANDS = [
  { command: "start", description: "Start Rachel" },
  { command: "login", description: "Sign in to an AI provider" },
  { command: "login_code", description: "Complete Claude sign-in" },
  { command: "login_cancel", description: "Cancel provider sign-in" },
  { command: "login_status", description: "Check provider sign-in" },
  { command: "connector_connect", description: "Connect Slack or Linear" },
  { command: "connector_callback", description: "Complete Linear authorization" },
  { command: "connector_cancel", description: "Cancel connector authorization" },
  { command: "connector_status", description: "Check Slack and Linear" },
] as const;
