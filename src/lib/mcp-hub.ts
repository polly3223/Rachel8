import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { z } from "zod";
import { env } from "../config/env.ts";
import { errorMessage } from "./errors.ts";
import { KeyedQueue } from "./keyed-queue.ts";
import { createOAuthFetch, VaultOAuthProvider } from "./mcp-oauth.ts";
import {
  isHttpConnectorReady,
  loadConnectors,
  loadOAuthState,
  normalizeConnectorName,
  type ConnectorSpec,
  type HttpConnectorSpec,
} from "./mcp-store.ts";

export interface ExternalMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ConnectorCapability {
  name: string;
  type: "http" | "stdio";
  status: "connected" | "auth_required" | "pending" | "disabled" | "error";
  tools?: number;
  expiresAt?: string;
  error?: string;
}

interface LiveClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
  fingerprint: string;
}

const PROBE_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class McpHub {
  private readonly queue = new KeyedQueue<string>();
  private readonly clients = new Map<string, LiveClient>();
  private socketDir?: string;
  private socketPath?: string;
  private server?: ReturnType<typeof Bun.serve>;

  constructor(
    private readonly sharedDir: string,
    private readonly bridgeScript = join(process.cwd(), "scripts", "mcp-bridge.ts"),
  ) {}

  private ensureSocket(): string {
    if (this.socketPath) return this.socketPath;
    const dir = mkdtempSync(join(tmpdir(), "rachel-mcp-"));
    chmodSync(dir, 0o700);
    const socket = join(dir, "hub.sock");
    try {
      this.server = Bun.serve({
        unix: socket,
        fetch: async (req) => this.handleRequest(req),
      });
      chmodSync(socket, 0o600);
      this.socketDir = dir;
      this.socketPath = socket;
      return socket;
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/servers\/([^/]+)\/(tools|call)$/);
    if (!match) return new Response("Not found", { status: 404 });
    const name = normalizeConnectorName(decodeURIComponent(match[1]!));
    if (!name) return new Response("Invalid connector name", { status: 400 });
    try {
      if (req.method === "GET" && match[2] === "tools") {
        const result = await this.listHttpTools(name);
        return Response.json({ tools: result.tools });
      }
      if (req.method === "POST" && match[2] === "call") {
        const body = z
          .object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) })
          .parse(await req.json());
        return Response.json(await this.callHttpTool(name, body.name, body.arguments));
      }
      return new Response("Method not allowed", { status: 405 });
    } catch (error) {
      return new Response(errorMessage(error), { status: 500 });
    }
  }

  private async getHttpSpec(name: string): Promise<HttpConnectorSpec> {
    const connectors = await loadConnectors(this.sharedDir);
    const spec = connectors[name];
    if (!spec || spec.type !== "http") throw new Error(`HTTP connector "${name}" is not configured.`);
    if (!spec.enabled) throw new Error(`Connector "${name}" is disabled.`);
    return spec;
  }

  private async closeClient(name: string): Promise<void> {
    const existing = this.clients.get(name);
    if (!existing) return;
    this.clients.delete(name);
    await existing.client.close().catch(() => {});
  }

  async invalidate(name: string): Promise<void> {
    await this.queue.run(name, () => this.closeClient(name));
  }

  private async getClient(name: string): Promise<Client> {
    return this.queue.run(name, async () => {
      const spec = await this.getHttpSpec(name);
      const fingerprint = JSON.stringify(spec);
      const cached = this.clients.get(name);
      if (cached && cached.fingerprint === fingerprint) return cached.client;
      if (cached) await this.closeClient(name);

      const useOAuth = !spec.noAuth && !(spec.headers && Object.keys(spec.headers).length > 0);
      const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
        ...(spec.headers ? { requestInit: { headers: spec.headers } } : {}),
        ...(useOAuth
          ? {
              authProvider: new VaultOAuthProvider(this.sharedDir, name, spec, false),
              fetch: createOAuthFetch(),
            }
          : {}),
      });
      const client = new Client({ name: "rachel8", version: "1" }, { capabilities: {} });
      try {
        await client.connect(transport);
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
      this.clients.set(name, { client, transport, fingerprint });
      return client;
    });
  }

  async listHttpTools(name: string) {
    try {
      const client = await this.getClient(name);
      return await client.listTools();
    } catch (error) {
      await this.invalidate(name);
      if (error instanceof UnauthorizedError) throw error;
      const client = await this.getClient(name);
      return await client.listTools();
    }
  }

  async callHttpTool(name: string, toolName: string, args: Record<string, unknown>) {
    const client = await this.getClient(name);
    try {
      return await client.callTool({ name: toolName, arguments: args });
    } catch (error) {
      // Never blindly retry a tool call on a mid-flight transport error; only close the stale client.
      await this.invalidate(name);
      throw error;
    }
  }

  async getProviderMcpServers(): Promise<ExternalMcpServer[]> {
    const connectors = await loadConnectors(this.sharedDir);
    const names = Object.keys(connectors).sort();
    const servers: ExternalMcpServer[] = [];
    for (const name of names) {
      const spec = connectors[name]!;
      if (!spec.enabled) continue;
      if (spec.type === "stdio") {
        servers.push({
          name,
          command: spec.command,
          args: spec.args,
          env: spec.env,
        });
        continue;
      }
      const state = await loadOAuthState(this.sharedDir, name);
      if (!isHttpConnectorReady(spec, state)) continue;
      const socket = this.ensureSocket();
      servers.push({
        name,
        command: process.execPath,
        args: [this.bridgeScript, socket, name],
        env: {},
      });
    }
    return servers;
  }

  private async probeStdio(name: string, spec: Extract<ConnectorSpec, { type: "stdio" }>): Promise<number> {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...process.env, ...spec.env } as Record<string, string>,
      stderr: "pipe",
    });
    const client = new Client({ name: "rachel8", version: "1" }, { capabilities: {} });
    try {
      await withTimeout(client.connect(transport), PROBE_TIMEOUT_MS, `${name} connect`);
      const res = await withTimeout(client.listTools(), PROBE_TIMEOUT_MS, `${name} listTools`);
      return res.tools.length;
    } finally {
      await client.close().catch(() => {});
    }
  }

  async probeConnector(name: string): Promise<{ tools: number }> {
    const connectors = await loadConnectors(this.sharedDir);
    const spec = connectors[name];
    if (!spec) throw new Error(`Connector "${name}" is not configured.`);
    if (!spec.enabled) throw new Error(`Connector "${name}" is disabled.`);
    if (spec.type === "stdio") {
      return { tools: await this.probeStdio(name, spec) };
    }
    const res = await withTimeout(this.listHttpTools(name), PROBE_TIMEOUT_MS, `${name} listTools`);
    return { tools: res.tools.length };
  }

  async capabilities(): Promise<ConnectorCapability[]> {
    const connectors = await loadConnectors(this.sharedDir);
    const entries = Object.entries(connectors).sort(([a], [b]) => a.localeCompare(b));
    return Promise.all(
      entries.map(async ([name, spec]): Promise<ConnectorCapability> => {
        if (!spec.enabled) return { name, type: spec.type, status: "disabled" };
        if (spec.type === "stdio") {
          try {
            const tools = await this.probeStdio(name, spec);
            return { name, type: "stdio", status: "connected", tools };
          } catch (error) {
            return { name, type: "stdio", status: "error", error: errorMessage(error) };
          }
        }
        const state = await loadOAuthState(this.sharedDir, name);
        if (!isHttpConnectorReady(spec, state)) {
          return { name, type: "http", status: state.pending ? "pending" : "auth_required" };
        }
        try {
          const res = await withTimeout(this.listHttpTools(name), PROBE_TIMEOUT_MS, `${name} listTools`);
          return {
            name,
            type: "http",
            status: "connected",
            tools: res.tools.length,
            ...(state.expiresAt ? { expiresAt: new Date(state.expiresAt).toISOString() } : {}),
          };
        } catch (error) {
          return {
            name,
            type: "http",
            status: error instanceof UnauthorizedError ? "auth_required" : "error",
            error: errorMessage(error),
          };
        }
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.clients.keys()].map((name) => this.closeClient(name)));
    if (this.server) {
      await this.server.stop(true);
      this.server = undefined;
    }
    if (this.socketDir) {
      rmSync(this.socketDir, { recursive: true, force: true });
      this.socketDir = undefined;
      this.socketPath = undefined;
    }
  }
}

let defaultHub: McpHub | undefined;
export function getMcpHub(): McpHub {
  defaultHub ??= new McpHub(env.SHARED_FOLDER_PATH);
  return defaultHub;
}
export async function shutdownMcpHub(): Promise<void> {
  if (!defaultHub) return;
  const hub = defaultHub;
  defaultHub = undefined;
  await hub.close();
}
