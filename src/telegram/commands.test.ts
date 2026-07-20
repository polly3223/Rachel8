import { describe, expect, test } from "bun:test";
import { BOT_COMMANDS, buildHelpText } from "./commands.ts";

describe("BOT_COMMANDS", () => {
  test("contains every registered command without duplicates", () => {
    const commands = BOT_COMMANDS.map(({ command }) => command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands).toContain("connector_connect");
    expect(commands).toContain("connector_status");
    expect(commands).toContain("effort");
    expect(commands).toContain("help");
  });

  test("help documents every command and valid effort", () => {
    const help = buildHelpText();
    for (const { command } of BOT_COMMANDS) {
      expect(help).toContain(`/${command}`);
    }
    expect(help).toContain("low, medium, high, xhigh, max, ultra");
    expect(help).toContain("Model Context Protocol (MCP)");
  });
});
