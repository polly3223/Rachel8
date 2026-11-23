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
  OAUTH_PENDING_TTL_MS,
  validateOAuthCallback,
} from "./mcp-oauth.ts";
import {
  connectorsFilePath,
  flusoCredentialsPath,
  isAllowedConnectorUrl,
  loadConnectors,
  loadOAuthState,
  oauthStatePath,
  saveFlusoCredentials,
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
    await saveFlusoCredentials(dir, { baseUrl: "https://api.fluso.ai/v1", token: "fluso_testtoken12345678" });
    expect(statSync(connectorsFilePath(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(oauthStatePath(dir, "linear")).mode & 0o777).toBe(0o600);
    expect(statSync(flusoCredentialsPath(dir)).mode & 0o777).toBe(0o600);
    expect((await loadConnectors(dir))["linear"]?.type).toBe("http");

    const symPath = oauthStatePath(dir, "attio");
    symlinkSync("/etc/hosts", symPath);
    await expect(loadOAuthState(dir, "attio")).rejects.toThrow("symlink");
  });
});

describe("mcp-oauth callback validation", () => {
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
});

describe("end-to-end direct DCR OAuth, Fluso connector, McpHub, and stdio bridge", () => {
  test("completes DCR OAuth, persists tokens, and proxies tools through mcp-bridge.ts", async () => {
    const dir = makeSharedDir();
    const expectedToken = "tok-initial";
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

      const startMsg = await startConnectorSession(`demo ${mcpUrl}`, dir, hub);
      expect(startMsg).toContain(`${mockServer.url.origin}/authorize?`);
      expect(startMsg).toContain("/connector_callback");
      expect(await getConnectorStatusMessage("demo", dir)).toContain("authorization pending");

      const stateBefore = await loadOAuthState(dir, "demo");
      const callbackUrl = `${stateBefore.pending!.redirectUri}?code=test-code-42&state=${encodeURIComponent(stateBefore.pending!.state)}`;
      expect(await submitConnectorCallback(callbackUrl, dir, hub)).toContain("demo is connected (1 tools)");
      expect(await getConnectorStatusMessage("demo", dir)).toContain("OAuth connected");
      expect(await hub.capabilities()).toEqual([
        expect.objectContaining({ name: "demo", type: "http", status: "connected", tools: 1 }),
      ]);

      const mounted = await hub.getProviderMcpServers();
      expect(mounted).toHaveLength(1);
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

      // Non-DCR apps route to Fluso
      await expect(startConnectorSession("gmail", dir, hub)).rejects.toThrow("fluso");
      await expect(startConnectorSession("slack", dir, hub)).rejects.toThrow("fluso");

      expect(await cancelConnectorSession({ name: "demo" }, dir)).toContain("No connector authorization is pending");
      const flow2 = await beginConnectorOAuth(dir, "demo", spec);
      expect(flow2.status).toBe("redirect");
      expect(await cancelConnectorSession({ name: "demo" }, dir)).toContain("Cancelled pending authorization for: demo");
      expect((await loadOAuthState(dir, "demo")).pending).toBeUndefined();
      expect(typeof completeConnectorOAuth).toBe("function");
    } finally {
      await hub.close();
      await mockServer.stop(true);
    }
  });

  test("exposes Fluso Cloud API tools over mcp-bridge.ts, deletes ephemeral threads, and surfaces approvals", async () => {
    const dir = makeSharedDir();
    const flusoToken = "fluso_testtoken_1234567890";
    const deletedThreads: string[] = [];
    let approvedOnce = false;

    const mockFluso = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.headers.get("authorization") !== `Bearer ${flusoToken}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        const url = new URL(req.url);
        if (url.pathname === "/v1/auth/me") {
          return Response.json({ user: { email: "owner@example.com" }, access: "write" });
        }
        if (url.pathname === "/v1/mcp-oauth/connections") {
          return Response.json({
            data: [
              { server_id: "google-workspace-gmail", display_name: "Gmail", status: "connected", tool_count: 24 },
              { server_id: "native-slack", display_name: "Slack", status: "connected", tool_count: 53 },
            ],
          });
        }
        if (url.pathname === "/v1/threads" && req.method === "POST") {
          const body = (await req.json()) as { input: string };
          if (body.input.includes("send email")) {
            return Response.json({ thread_id: "th-approve", input_id: "in-2", run_id: "run-2", disposition: "running" }, { status: 202 });
          }
          return Response.json({ thread_id: "th-read", input_id: "in-1", run_id: "run-1", disposition: "running" }, { status: 202 });
        }
        if (url.pathname === "/v1/threads/th-read/runs/run-1") {
          return Response.json({ id: "run-1", thread_id: "th-read", status: "completed", outcome: "completed" });
        }
        if (url.pathname === "/v1/threads/th-read/items") {
          return Response.json({
            data: [{ id: "m-1", type: "message", role: "assistant", text: "Found thread: Your wallet can wait" }],
            next_cursor: null,
            revision: "rev-1",
          });
        }
        if (url.pathname === "/v1/threads/th-read" && req.method === "DELETE") {
          deletedThreads.push("th-read");
          return Response.json({});
        }
        if (url.pathname === "/v1/threads/th-approve/runs/run-2") {
          return Response.json({
            id: "run-2",
            thread_id: "th-approve",
            status: approvedOnce ? "completed" : "waiting_action",
            outcome: approvedOnce ? "completed" : null,
          });
        }
        if (url.pathname === "/v1/threads/th-approve/state") {
          return Response.json({
            thread_id: "th-approve",
            pending_actions: [
              { id: "appr-1", kind: "mcp_tool", run_id: "run-2", url: "/v1/mcp-oauth/permissions/approvals/appr-1" },
            ],
          });
        }
        if (url.pathname === "/v1/mcp-oauth/permissions/approvals/appr-1" && req.method === "GET") {
          return Response.json({
            approval_id: "appr-1",
            server_id: "google-workspace-gmail",
            tool_name: "GMAIL__SEND_EMAIL",
            arguments: { to: "alice@example.com" },
            status: "pending",
          });
        }
        if (url.pathname === "/v1/mcp-oauth/permissions/approvals/appr-1/decision" && req.method === "POST") {
          const body = (await req.json()) as { decision: string; scope: string };
          expect(body).toEqual({ decision: "allow", scope: "once" });
          approvedOnce = true;
          return Response.json({ approval_id: "appr-1", status: "allowed", decision_scope: "once" });
        }
        if (url.pathname === "/v1/threads/th-approve/items") {
          return Response.json({
            data: [{ id: "m-2", type: "message", role: "assistant", text: "Email sent." }],
            next_cursor: null,
            revision: "rev-2",
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const hub = new McpHub(dir);
    try {
      const baseUrl = `${mockFluso.url.origin}/v1`;
      await upsertConnector(dir, "fluso", { type: "fluso", baseUrl, enabled: true });
      const connectMsg = await startConnectorSession(`fluso ${flusoToken}`, dir, hub);
      expect(connectMsg).toContain("fluso is connected (5 tools)");
      expect(connectMsg).toContain("Gmail, Slack");
      expect(await getConnectorStatusMessage("fluso", dir)).toContain("developer token saved");

      const caps = await hub.capabilities();
      expect(caps).toEqual([
        expect.objectContaining({
          name: "fluso",
          type: "fluso",
          status: "connected",
          tools: 5,
          apps: ["Gmail", "Slack"],
        }),
      ]);

      const mounted = await hub.getProviderMcpServers();
      expect(mounted.map((s) => s.name)).toEqual(["fluso"]);

      const client = new Client({ name: "test-provider", version: "1" }, { capabilities: {} });
      const stdio = new StdioClientTransport({
        command: mounted[0]!.command,
        args: mounted[0]!.args,
        stderr: "pipe",
      });
      try {
        await client.connect(stdio);
        const tools = await client.listTools();
        expect(tools.tools.map((t) => t.name)).toContain("fluso_run");

        // 1. Ephemeral read query completes and deletes its temporary thread
        const readRes = await client.callTool({
          name: "fluso_run",
          arguments: { prompt: "Read Gmail thread Your wallet can wait" },
        });
        const readJson = JSON.parse(((readRes.content as Array<{ text: string }>)[0]!).text) as Record<string, unknown>;
        expect(readJson["status"]).toBe("completed");
        expect(readJson["answer"]).toBe("Found thread: Your wallet can wait");
        expect(readJson["thread_deleted"]).toBe(true);
        expect(deletedThreads).toEqual(["th-read"]);

        // 2. Write query pauses on waiting_action and surfaces exact approval payload
        const pauseRes = await client.callTool({
          name: "fluso_run",
          arguments: { prompt: "send email to alice" },
        });
        const pauseJson = JSON.parse(((pauseRes.content as Array<{ text: string }>)[0]!).text) as Record<string, unknown>;
        expect(pauseJson["status"]).toBe("waiting_action");
        expect(JSON.stringify(pauseJson["pending_actions"])).toContain("GMAIL__SEND_EMAIL");

        // 3. Explicit once-approval resumes and completes
        const approveRes = await client.callTool({
          name: "fluso_approve",
          arguments: { approval_id: "appr-1", decision: "allow", thread_id: "th-approve", run_id: "run-2" },
        });
        const approveJson = JSON.parse(((approveRes.content as Array<{ text: string }>)[0]!).text) as {
          approval: { status: string };
          run: { status: string; answer: string };
        };
        expect(approveJson.approval.status).toBe("allowed");
        expect(approveJson.run.status).toBe("completed");
        expect(approveJson.run.answer).toBe("Email sent.");
      } finally {
        await client.close();
      }
    } finally {
      await hub.close();
      await mockFluso.stop(true);
    }
  });
});
