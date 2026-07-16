import { describe, expect, test } from "bun:test";
import { commandArg } from "./command.ts";

describe("commandArg", () => {
  test("returns all text after the command", () => {
    expect(commandArg("/connector_callback http://localhost:1234/callback/x?a=1&b=2"))
      .toBe("http://localhost:1234/callback/x?a=1&b=2");
  });

  test("returns undefined when no argument is present", () => {
    expect(commandArg("/connector_status")).toBeUndefined();
  });
});
