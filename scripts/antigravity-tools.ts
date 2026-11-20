// The stdio MCP server runs in a separate process. Its private socket belongs to one Rachel turn.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const socket = process.argv[2];
if (!socket) throw new Error("Missing turn socket");
const server = new Server({ name: "rachel", version: "1" }, { capabilities: { tools: {} } });
async function request(params?: { name: string; arguments?: Record<string, unknown> }) {
  const response = await fetch("http://localhost/tools", {
    unix: socket,
    method: params ? "POST" : "GET",
    body: params ? JSON.stringify(params) : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response;
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: await (await request()).json(),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
  content: [{ type: "text", text: await (await request(params)).text() }],
}));
await server.connect(new StdioServerTransport());
