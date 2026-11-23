import { z } from "zod";
import {
  DEFAULT_FLUSO_BASE_URL,
  loadFlusoCredentials,
  type FlusoConnectorSpec,
} from "./mcp-store.ts";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PAUSED_RUN_STATUSES = new Set(["waiting_action", "held"]);
const MAX_ITEM_PAGES = 20;

const runArgsSchema = z.object({
  prompt: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  keep_thread: z.boolean().default(false),
  timeout_seconds: z.number().min(5).max(300).default(120),
});

const statusArgsSchema = z.object({
  thread_id: z.string().min(1),
  run_id: z.string().min(1),
  wait_seconds: z.number().min(0).max(300).default(0),
  cancel: z.boolean().default(false),
});

const approveArgsSchema = z.object({
  approval_id: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
  thread_id: z.string().min(1).optional(),
  run_id: z.string().min(1).optional(),
  wait_seconds: z.number().min(0).max(300).default(60),
});

export interface FlusoConnectionSummary {
  server_id: string;
  display_name: string;
  status: string;
  tool_count?: number;
}

export interface FlusoProbeResult {
  email: string;
  access: string;
  apps: FlusoConnectionSummary[];
}

export const FLUSO_MCP_TOOLS = [
  {
    name: "fluso_connections",
    description:
      "List apps connected in the owner's Fluso Cloud account (e.g. Gmail, Slack, Google Calendar, Drive, Docs, Sheets, Slides) with status and tool counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fluso_run",
    description:
      "Run a task in the owner's Fluso Cloud workspace to access Fluso-connected apps such as Gmail, Slack, Google Calendar, Drive, Docs, Sheets and Slides. Waits for completion and returns the answer, or returns pending tool approval details if Fluso pauses for write/send permission. Ephemeral threads are deleted on clean completion unless keep_thread is true.",
    inputSchema: z.toJSONSchema(runArgsSchema),
  },
  {
    name: "fluso_status",
    description:
      "Check the status and output of a Fluso run (optionally waiting up to wait_seconds) or cancel an active run.",
    inputSchema: z.toJSONSchema(statusArgsSchema),
  },
  {
    name: "fluso_approve",
    description:
      "Allow once or deny a pending Fluso tool approval returned in waiting_action. Only approve external writes or sends after explicit owner authorization.",
    inputSchema: z.toJSONSchema(approveArgsSchema),
  },
  {
    name: "fluso_agents",
    description: "List saved agents in the owner's Fluso Cloud account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

interface FlusoAuth {
  baseUrl: string;
  token: string;
}

async function resolveFlusoAuth(
  sharedDir: string,
  spec?: FlusoConnectorSpec,
): Promise<FlusoAuth> {
  const creds = await loadFlusoCredentials(sharedDir);
  if (!creds?.token) {
    throw new Error(
      "Fluso developer token is not configured. Run /connector_connect fluso <token>.",
    );
  }
  const baseUrl = (spec?.baseUrl ?? creds.baseUrl ?? DEFAULT_FLUSO_BASE_URL).replace(/\/+$/, "");
  return { baseUrl, token: creds.token };
}

async function flusoFetch<T = unknown>(
  auth: FlusoAuth,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : path.startsWith("/v1/")
      ? new URL(path, new URL(auth.baseUrl).origin).toString()
      : `${auth.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (new URL(url).origin !== new URL(auth.baseUrl).origin) {
    throw new Error("Refusing cross-origin Fluso API request");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    Accept: "application/json",
    ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...init.headers,
  };
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Fluso API ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function probeFlusoConnector(
  sharedDir: string,
  spec?: FlusoConnectorSpec,
): Promise<FlusoProbeResult> {
  const auth = await resolveFlusoAuth(sharedDir, spec);
  const [me, conns] = await Promise.all([
    flusoFetch<{ user?: { email?: string }; access?: string }>(auth, "/auth/me"),
    flusoFetch<{ data?: Array<Record<string, unknown>> }>(auth, "/mcp-oauth/connections"),
  ]);
  const apps: FlusoConnectionSummary[] = (conns.data ?? []).map((item) => ({
    server_id: String(item["server_id"] ?? ""),
    display_name: String(item["display_name"] ?? item["server_id"] ?? ""),
    status: String(item["status"] ?? "unknown"),
    ...(typeof item["tool_count"] === "number" ? { tool_count: item["tool_count"] } : {}),
  }));
  return {
    email: me.user?.email ?? "unknown",
    access: me.access ?? "unknown",
    apps,
  };
}

interface FlusoRunRecord {
  id: string;
  thread_id: string;
  status: string;
  outcome?: string | null;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
}

async function waitForRun(
  auth: FlusoAuth,
  threadId: string,
  runId: string,
  timeoutMs: number,
): Promise<{ run: FlusoRunRecord; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 600;
  while (true) {
    const run = await flusoFetch<FlusoRunRecord>(
      auth,
      `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
    );
    if (TERMINAL_RUN_STATUSES.has(run.status) || PAUSED_RUN_STATUSES.has(run.status)) {
      return { run, timedOut: false };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { run, timedOut: true };
    await Bun.sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(2500, Math.round(delayMs * 1.4));
  }
}

async function readPendingActions(auth: FlusoAuth, threadId: string): Promise<unknown[]> {
  const state = await flusoFetch<{
    pending_actions?: Array<{ id: string; kind: string; run_id: string; url?: string | null }>;
  }>(auth, `/threads/${encodeURIComponent(threadId)}/state`);
  const actions = state.pending_actions ?? [];
  return Promise.all(
    actions.map(async (action) => {
      if (!action.url) return action;
      try {
        const detail = await flusoFetch<Record<string, unknown>>(auth, action.url);
        return { ...action, detail };
      } catch {
        return action;
      }
    }),
  );
}

async function readRunOutput(
  auth: FlusoAuth,
  threadId: string,
  runId: string,
): Promise<{ answer: string; attachments: unknown[] }> {
  const messages: string[] = [];
  const attachments: unknown[] = [];
  let after: string | null = null;
  let revision: string | null = null;
  for (let page = 0; page < MAX_ITEM_PAGES; page++) {
    const query = new URLSearchParams({ run_id: runId, limit: "100" });
    if (after) query.set("after", after);
    if (revision) query.set("revision", revision);
    const res = await flusoFetch<{
      data?: Array<Record<string, unknown>>;
      next_cursor?: string | null;
      revision?: string;
    }>(auth, `/threads/${encodeURIComponent(threadId)}/items?${query.toString()}`);
    for (const item of res.data ?? []) {
      if (item["type"] === "message" && item["role"] === "assistant") {
        const text = typeof item["text"] === "string" ? item["text"].trim() : "";
        if (text) messages.push(text);
        if (Array.isArray(item["attachments"]) && item["attachments"].length) {
          attachments.push(...item["attachments"]);
        }
      }
    }
    if (!res.next_cursor) break;
    after = res.next_cursor;
    revision = res.revision ?? revision;
  }
  return { answer: messages.join("\n\n"), attachments };
}

async function buildRunSummary(
  auth: FlusoAuth,
  threadId: string,
  run: FlusoRunRecord,
  options: { timedOut?: boolean; deleteOnComplete?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (run.status === "waiting_action") {
    const pending_actions = await readPendingActions(auth, threadId);
    return {
      status: run.status,
      thread_id: threadId,
      run_id: run.id,
      pending_actions,
      note: "Fluso paused for approval. Ask the owner for authorization before calling fluso_approve.",
    };
  }
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    const { answer, attachments } = await readRunOutput(auth, threadId, run.id);
    let threadDeleted = false;
    if (options.deleteOnComplete && run.status === "completed") {
      await flusoFetch(auth, `/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" })
        .then(() => {
          threadDeleted = true;
        })
        .catch(() => {});
    }
    return {
      status: run.status,
      ...(run.outcome ? { outcome: run.outcome } : {}),
      ...(run.error ? { error: run.error } : {}),
      answer,
      ...(attachments.length ? { attachments } : {}),
      thread_id: threadId,
      run_id: run.id,
      thread_deleted: threadDeleted,
    };
  }
  return {
    status: run.status,
    timed_out: Boolean(options.timedOut),
    thread_id: threadId,
    run_id: run.id,
    note: "Run is still active. Poll with fluso_status or cancel with cancel=true.",
  };
}

export async function callFlusoTool(
  sharedDir: string,
  spec: FlusoConnectorSpec,
  toolName: string,
  rawArgs: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const auth = await resolveFlusoAuth(sharedDir, spec);
  let result: unknown;
  if (toolName === "fluso_connections") {
    const probe = await probeFlusoConnector(sharedDir, spec);
    result = probe;
  } else if (toolName === "fluso_agents") {
    const res = await flusoFetch<{ data?: unknown[] }>(auth, "/agents");
    result = { agents: res.data ?? [] };
  } else if (toolName === "fluso_run") {
    const args = runArgsSchema.parse(rawArgs);
    const createdNew = !args.thread_id;
    const receipt = args.thread_id
      ? await flusoFetch<{ thread_id: string; run_id: string }>(
          auth,
          `/threads/${encodeURIComponent(args.thread_id)}/inputs`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: {
              input: args.prompt,
              mode: "queue",
              reasoning_effort: args.reasoning_effort,
            },
          },
        )
      : await flusoFetch<{ thread_id: string; run_id: string }>(auth, "/threads", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {
            input: args.prompt,
            reasoning_effort: args.reasoning_effort,
            ...(args.agent_id ? { agent_id: args.agent_id } : {}),
          },
        });
    const { run, timedOut } = await waitForRun(
      auth,
      receipt.thread_id,
      receipt.run_id,
      args.timeout_seconds * 1000,
    );
    result = await buildRunSummary(auth, receipt.thread_id, run, {
      timedOut,
      deleteOnComplete: createdNew && !args.keep_thread,
    });
  } else if (toolName === "fluso_status") {
    const args = statusArgsSchema.parse(rawArgs);
    if (args.cancel) {
      result = await flusoFetch(
        auth,
        `/threads/${encodeURIComponent(args.thread_id)}/runs/${encodeURIComponent(args.run_id)}/cancel`,
        { method: "POST" },
      );
    } else {
      const { run, timedOut } = await waitForRun(
        auth,
        args.thread_id,
        args.run_id,
        args.wait_seconds * 1000,
      );
      result = await buildRunSummary(auth, args.thread_id, run, { timedOut });
    }
  } else if (toolName === "fluso_approve") {
    const args = approveArgsSchema.parse(rawArgs);
    const decision = await flusoFetch<Record<string, unknown>>(
      auth,
      `/mcp-oauth/permissions/approvals/${encodeURIComponent(args.approval_id)}/decision`,
      {
        method: "POST",
        body: { decision: args.decision, scope: "once" },
      },
    );
    if (args.thread_id && args.run_id && args.wait_seconds > 0) {
      const { run, timedOut } = await waitForRun(
        auth,
        args.thread_id,
        args.run_id,
        args.wait_seconds * 1000,
      );
      result = {
        approval: decision,
        run: await buildRunSummary(auth, args.thread_id, run, { timedOut }),
      };
    } else {
      result = { approval: decision };
    }
  } else {
    return {
      content: [{ type: "text", text: `Unknown Fluso tool: ${toolName}` }],
      isError: true,
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
