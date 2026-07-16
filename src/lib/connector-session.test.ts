import { describe, expect, test } from "bun:test";
import {
  extractLinearOAuthDetails,
  normalizeConnector,
  slackProbeSucceeded,
  validateLinearCallback,
} from "./connector-session.ts";

describe("normalizeConnector", () => {
  test("accepts supported connector names", () => {
    expect(normalizeConnector(" Linear ")).toBe("linear");
    expect(normalizeConnector("SLACK")).toBe("slack");
  });

  test("rejects unsupported connector names", () => {
    expect(normalizeConnector("github")).toBeNull();
    expect(normalizeConnector()).toBeNull();
  });
});

describe("Linear OAuth parsing", () => {
  const callback = "http://127.0.0.1:39487/callback/secret-path";
  const authorize = `https://mcp.linear.app/authorize?response_type=code&redirect_uri=${encodeURIComponent(callback)}`;

  test("extracts the authorization and expected callback URLs", () => {
    expect(extractLinearOAuthDetails(`Open this:\n${authorize}\n`)).toEqual({
      authorizationUrl: authorize,
      expectedCallback: callback,
    });
  });

  test("accepts only the callback belonging to the active login", () => {
    const value = `${callback}?code=abc&state=def`;
    expect(validateLinearCallback(value, callback).toString()).toBe(value);
    expect(() => validateLinearCallback(value, "http://127.0.0.1:39487/callback/other"))
      .toThrow("does not belong");
  });

  test("blocks non-local URLs and callbacks without OAuth results", () => {
    expect(() => validateLinearCallback("https://example.com/callback/x?code=abc"))
      .toThrow("not a valid");
    expect(() => validateLinearCallback(`${callback}?state=def`)).toThrow("not a valid");
  });
});

describe("Slack probe parsing", () => {
  test("requires a completed, error-free Slack MCP call", () => {
    const success = JSON.stringify({
      type: "item.completed",
      item: {
        type: "mcp_tool_call",
        server: "codex_apps",
        tool: "slack.slack_search_public_and_private",
        status: "completed",
        error: null,
      },
    });
    expect(slackProbeSucceeded(success)).toBe(true);
    expect(slackProbeSucceeded('{"type":"item.completed","item":{"type":"agent_message"}}'))
      .toBe(false);
  });
});
