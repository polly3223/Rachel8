// Stdio MCP bridge for a Rachel-managed connector hosted on Rachel's private Unix socket.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const socket = process.argv[2];
const serverName = process.argv[3];
if (!socket || !serverName) throw new Error("Usage: mcp-bridge.ts <socket> <connector>");

const basePath = `/servers/${encodeURIComponent(serverName)}`;
const server = new Server({ name: serverName, version: "1" }, { capabilities: { tools: {} } });

async function hubRequest(path: string, body?: unknown) {
  const response = await fetch(`http://localhost${path}`, {
    unix: socket,
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.json();
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return (await hubRequest(`${basePath}/tools`)) as { tools: unknown[] };
});

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  return (await hubRequest(`${basePath}/call`, {
    name: params.name,
    arguments: params.arguments ?? {},
  })) as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
});

await server.connect(new StdioServerTransport());
