import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  cancelConnectorSession,
  getConnectorStatusMessage,
  normalizeConnector,
  startConnectorSession,
  submitConnectorCallback,
} from "./connector-session.ts";
import { McpHub } from "./mcp-hub.ts";
import {
  beginConnectorOAuth,
  completeConnectorOAuth,
  createOAuthFetch,
  OAUTH_PENDING_TTL_MS,
  validateOAuthCallback,
} from "./mcp-oauth.ts";
import {
  connectorsFilePath,
  isAllowedConnectorUrl,
  loadConnectors,
  loadOAuthState,
  oauthStatePath,
  saveOAuthState,
  upsertConnector,
} from "./mcp-store.ts";

const tempDirs: string[] = [];
function makeSharedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rachel-mcp-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("mcp-store validation and vault permissions", () => {
  test("validates connector names and rejects reserved or malformed names", () => {
    expect(normalizeConnector(" Linear ")).toBe("linear");
    expect(normalizeConnector("my_mcp-1")).toBe("my_mcp-1");
    expect(normalizeConnector("rachel")).toBeNull();
    expect(normalizeConnector("../escape")).toBeNull();
    expect(normalizeConnector()).toBeNull();
  });

  test("restricts URLs to https or loopback http", () => {
    expect(isAllowedConnectorUrl("https://mcp.linear.app/mcp")).toBe(true);
    expect(isAllowedConnectorUrl("http://127.0.0.1:8787/mcp")).toBe(true);
    expect(isAllowedConnectorUrl("http://localhost:8787/mcp")).toBe(true);
    expect(isAllowedConnectorUrl("http://example.com/mcp")).toBe(false);
    expect(isAllowedConnectorUrl("file:///etc/passwd")).toBe(false);
  });

  test("writes vault files mode 0600 and refuses symlinks", async () => {
    const dir = makeSharedDir();
    await upsertConnector(dir, "linear", { type: "http", url: "https://mcp.linear.app/mcp", enabled: true });
    await saveOAuthState(dir, "linear", { tokens: { access_token: "tok", token_type: "Bearer" } });
    expect(statSync(connectorsFilePath(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(oauthStatePath(dir, "linear")).mode & 0o777).toBe(0o600);
    expect((await loadConnectors(dir))["linear"]?.type).toBe("http");

    const symPath = oauthStatePath(dir, "attio");
    symlinkSync("/etc/hosts", symPath);
    await expect(loadOAuthState(dir, "attio")).rejects.toThrow("symlink");
  });
});

describe("mcp-oauth callback validation and Slack response normalization", () => {
  const pending = {
    state: "expected-state-123",
    redirectUri: "http://127.0.0.1:18472/callback/linear",
    authorizationUrl: "https://mcp.linear.app/authorize?state=expected-state-123",
    createdAt: 1_000_000,
  };

  test("accepts an exact matching callback within TTL", () => {
    const ok = validateOAuthCallback(
      "http://127.0.0.1:18472/callback/linear?code=abc&state=expected-state-123",
      pending,
      1_000_500,
    );
    expect(ok).toEqual({ code: "abc", state: "expected-state-123" });
  });

  test("rejects mismatched origin/path, wrong state, expired flow, denied error, and missing code", () => {
    expect(() =>
      validateOAuthCallback(
        "http://127.0.0.1:18472/callback/other?code=abc&state=expected-state-123",
        pending,
        1_000_500,
      ),
    ).toThrow("does not match");
    expect(() =>
      validateOAuthCallback(
        "http://127.0.0.1:18472/callback/linear?code=abc&state=wrong-state",
        pending,
        1_000_500,
      ),
    ).toThrow("state mismatch");
    expect(() =>
      validateOAuthCallback(
        "http://127.0.0.1:18472/callback/linear?code=abc&state=expected-state-123",
        pending,
        pending.createdAt + OAUTH_PENDING_TTL_MS + 1,
      ),
    ).toThrow("expired");
    expect(() =>
      validateOAuthCallback(
        "http://127.0.0.1:18472/callback/linear?error=access_denied&state=expected-state-123",
        pending,
        1_000_500,
      ),
    ).toThrow("access_denied");
    expect(() =>
      validateOAuthCallback(
        "http://127.0.0.1:18472/callback/linear?state=expected-state-123",
        pending,
        1_000_500,
      ),
    ).toThrow("missing an authorization code");
  });

  test("normalizes Slack authed_user and user token_type responses", async () => {
    const fakeFetch = createOAuthFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          authed_user: { access_token: "xoxe.xoxp-1", refresh_token: "xoxe-r1", expires_in: 43200 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await fakeFetch("https://slack.com/api/oauth.v2.user.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=123",
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["access_token"]).toBe("xoxe.xoxp-1");
    expect(json["refresh_token"]).toBe("xoxe-r1");
    expect(json["token_type"]).toBe("Bearer");
  });
});

describe("end-to-end provider-agnostic OAuth, McpHub, and stdio bridge", () => {
  test("completes DCR OAuth, persists tokens, and proxies tools through mcp-bridge.ts", async () => {
    const dir = makeSharedDir();
    let expectedToken = "tok-initial";
    const mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const origin = url.origin;
        if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
          return Response.json({
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
            scopes_supported: ["read"],
          });
        }
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return Response.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          });
        }
        if (url.pathname === "/register" && req.method === "POST") {
          const body = (await req.json()) as Record<string, unknown>;
          return Response.json(
            { client_id: "dcr-client-1", redirect_uris: body["redirect_uris"] },
            { status: 201 },
          );
        }
        if (url.pathname === "/token" && req.method === "POST") {
          return Response.json({
            access_token: expectedToken,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "refresh-1",
          });
        }
        if (url.pathname === "/mcp") {
          if (req.headers.get("authorization") !== `Bearer ${expectedToken}`) {
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
              },
            });
          }
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          const mcp = new Server({ name: "mock-remote", version: "1" }, { capabilities: { tools: {} } });
          mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
              {
                name: "echo_note",
                description: "Echo a note",
                inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
              },
            ],
          }));
          mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
            content: [{ type: "text", text: `echo:${String(params.arguments?.["msg"] ?? "")}` }],
          }));
          await mcp.connect(transport);
          return transport.handleRequest(req);
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const hub = new McpHub(dir);
    try {
      const mcpUrl = `${mockServer.url.origin}/mcp`;
      const spec = { type: "http" as const, url: mcpUrl, enabled: true };
      await upsertConnector(dir, "demo", spec);

      // 1. Start OAuth via Telegram command flow
      const startMsg = await startConnectorSession(`demo ${mcpUrl}`, dir, hub);
      expect(startMsg).toContain(`${mockServer.url.origin}/authorize?`);
      expect(startMsg).toContain("/connector_callback");

      const statusPending = await getConnectorStatusMessage("demo", dir);
      expect(statusPending).toContain("authorization pending");

      // 2. Complete OAuth with the exact pending state
      const stateBefore = await loadOAuthState(dir, "demo");
      expect(stateBefore.pending?.state).toBeTruthy();
      const callbackUrl = `${stateBefore.pending!.redirectUri}?code=test-code-42&state=${encodeURIComponent(stateBefore.pending!.state)}`;
      const doneMsg = await submitConnectorCallback(callbackUrl, dir, hub);
      expect(doneMsg).toContain("demo is connected (1 tools)");

      // 3. Status and capabilities report connected
      expect(await getConnectorStatusMessage("demo", dir)).toContain("OAuth connected");
      const caps = await hub.capabilities();
      expect(caps).toEqual([
        expect.objectContaining({ name: "demo", type: "http", status: "connected", tools: 1 }),
      ]);

      // 4. Mount via provider-agnostic stdio bridge and call the remote tool end-to-end
      const mounted = await hub.getProviderMcpServers();
      expect(mounted).toHaveLength(1);
      expect(mounted[0]!.name).toBe("demo");

      const client = new Client({ name: "test-provider", version: "1" }, { capabilities: {} });
      const stdio = new StdioClientTransport({
        command: mounted[0]!.command,
        args: mounted[0]!.args,
        stderr: "pipe",
      });
      try {
        await client.connect(stdio);
        const listed = await client.listTools();
        expect(listed.tools.map((t) => t.name)).toEqual(["echo_note"]);
        const res = await client.callTool({ name: "echo_note", arguments: { msg: "hello-rachel" } });
        expect(res.content).toEqual([{ type: "text", text: "echo:hello-rachel" }]);
      } finally {
        await client.close();
      }

      // 5. Cancel when nothing pending + Slack/Gmail setup hints
      expect(await cancelConnectorSession({ name: "demo" }, dir)).toContain("No connector authorization is pending");
      const slackHint = await startConnectorSession("slack", dir, hub);
      expect(slackHint).toContain("mcp.slack.com/mcp");
      expect(slackHint).toContain("oauth.clientId");
      await expect(startConnectorSession("gmail", dir, hub)).rejects.toThrow("gws");

      // 6. Verify direct begin/complete helper + cancel clears pending
      const flow2 = await beginConnectorOAuth(dir, "demo", spec);
      expect(flow2.status).toBe("redirect");
      expect(await cancelConnectorSession({ name: "demo" }, dir)).toContain("Cancelled pending authorization for: demo");
      expect((await loadOAuthState(dir, "demo")).pending).toBeUndefined();
      // Keep reference to completeConnectorOAuth tested via submitConnectorCallback above
      expect(typeof completeConnectorOAuth).toBe("function");
    } finally {
      await hub.close();
      await mockServer.stop(true);
    }
  });
});
