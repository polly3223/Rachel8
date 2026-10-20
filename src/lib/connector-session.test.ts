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

  test.each(["code=test-code&state=test-state", "error=access_denied&state=test-state"])(
    "accepts the current root callback with %s",
    (result) => {
      const rootCallback = "http://127.0.0.1:39487/callback";
      const details = extractLinearOAuthDetails(
        `https://mcp.linear.app/authorize?redirect_uri=${encodeURIComponent(rootCallback)}`,
      );
      const value = `${rootCallback}?${result}&iss=https%3A%2F%2Fmcp.linear.app`;
      expect(validateLinearCallback(value, details.expectedCallback).toString()).toBe(value);
    },
  );

  test.each([
    "http://127.0.0.1:39488/callback",
    "http://127.0.0.1:39487/callback/other",
    "http://localhost:39487/callback",
  ])("rejects a root callback from a different active login: %s", (expected) => {
    expect(() => validateLinearCallback("http://127.0.0.1:39487/callback?code=test", expected))
      .toThrow("does not belong");
  });

  test.each(["/callback-other", "/callbacks", "/callback%2Fother", "/other"])(
    "rejects lookalike callback paths: %s",
    (path) => {
      expect(() => validateLinearCallback(`http://127.0.0.1:39487${path}?code=test`))
        .toThrow("not a valid");
    },
  );

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
