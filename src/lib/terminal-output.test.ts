import { describe, expect, test } from "bun:test";
import { cleanTerminalOutput, outputTail } from "./terminal-output.ts";

describe("terminal output helpers", () => {
  test("removes ANSI escapes and repeated blank lines", () => {
    expect(cleanTerminalOutput("\u001b[32mok\u001b[0m\r\n\n\nnext  \n")).toBe("ok\n\nnext");
  });

  test("returns the requested output tail", () => {
    expect(outputTail("one\ntwo\nthree", 2)).toBe("two\nthree");
  });
});
