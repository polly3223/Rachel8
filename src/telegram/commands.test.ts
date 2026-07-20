import { describe, expect, test } from "bun:test";
import { REASONING_EFFORTS } from "../lib/reasoning-effort.ts";
import { BOT_COMMANDS, EFFORT_SET_COMMANDS, buildHelpText } from "./commands.ts";

describe("BOT_COMMANDS", () => {
  test("contains only help and one-tap effort commands", () => {
    const commands = BOT_COMMANDS.map(({ command }) => command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands).toEqual([
      "help",
      "effort",
      ...REASONING_EFFORTS.map((effort) => `effort_${effort}`),
    ]);
    expect(EFFORT_SET_COMMANDS.map(({ effort }) => effort)).toEqual([...REASONING_EFFORTS]);
  });

  test("help documents every visible command and advanced commands", () => {
    const help = buildHelpText();
    for (const { command } of BOT_COMMANDS) {
      expect(help).toContain(`/${command}`);
    }
    expect(help).not.toContain("/effort <level>");
    expect(help).toContain("Model Context Protocol (MCP)");
  });
});
