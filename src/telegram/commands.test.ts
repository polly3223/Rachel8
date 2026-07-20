import { describe, expect, test } from "bun:test";
import { BOT_COMMANDS } from "./commands.ts";

describe("BOT_COMMANDS", () => {
  test("contains every registered command without duplicates", () => {
    const commands = BOT_COMMANDS.map(({ command }) => command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands).toContain("connector_connect");
    expect(commands).toContain("connector_status");
    expect(commands).toContain("effort");
  });
});
