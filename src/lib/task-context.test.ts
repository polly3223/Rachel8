import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_TASK_CONTEXT,
  parseAgentTaskContext,
} from "./task-context.ts";

describe("parseAgentTaskContext", () => {
  test("preserves legacy tasks in the shared context", () => {
    expect(parseAgentTaskContext(undefined)).toBe(DEFAULT_AGENT_TASK_CONTEXT);
  });

  test("accepts project-scoped context slugs", () => {
    expect(parseAgentTaskContext("robot-media")).toBe("robot-media");
    expect(parseAgentTaskContext("research.daily_v2")).toBe("research.daily_v2");
  });

  test("rejects invalid context values", () => {
    expect(() => parseAgentTaskContext("Robot Media")).toThrow();
    expect(() => parseAgentTaskContext("")).toThrow();
    expect(() => parseAgentTaskContext(42)).toThrow();
  });
});
