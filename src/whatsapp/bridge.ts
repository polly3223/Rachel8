import { chmodSync } from "node:fs";
import { z } from "zod";
import * as wa from "./client.ts";

const socketPath =
  Bun.env["RACHEL_WHATSAPP_SOCKET"] ?? `/run/user/${process.getuid?.()}/rachel8-whatsapp.sock`;
process.umask(0o077);
const requestSchema = z.object({
  action: z.enum([
    "connect",
    "connect-qr",
    "status",
    "groups",
    "contacts",
    "messages",
    "search",
    "search-messages",
    "send",
    "send-file",
    "disconnect",
  ]),
  args: z.array(z.string()).default([]),
});
const server = Bun.serve({
  unix: socketPath,
  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { action, args } = requestSchema.parse(await request.json());
      const required = (i: number) => {
        const value = args[i];
        if (!value) throw new Error(`Missing argument ${i + 1}`);
        return value;
      };
      let result: unknown;
      switch (action) {
        case "connect":
          result = await wa.connect("pairing", required(0));
          break;
        case "connect-qr":
          result = await wa.connect("qr");
          break;
        case "status":
          result = { status: wa.getStatus() };
          break;
        case "groups":
          result = await wa.groups();
          break;
        case "contacts":
          result = await wa.contacts(required(0));
          break;
        case "messages":
          result = wa.history.recent(required(0), Number(args[1] ?? 20));
          break;
        case "search":
          result = wa.history.contactSearch(args.join(" "));
          break;
        case "search-messages":
          result = wa.history.search(args.join(" "));
          break;
        case "send":
          await wa.send(required(0), args.slice(1).join(" ") || required(1));
          result = { sent: true };
          break;
        case "send-file":
          await wa.sendFile(required(0), required(1), args.slice(2).join(" "));
          result = { sent: true };
          break;
        case "disconnect":
          await wa.disconnect();
          result = { unlinked: true };
          break;
      }
      return Response.json({ result });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 });
    }
  },
});
chmodSync(socketPath, 0o600);
void wa.restoreWhatsApp().catch(() => {});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    wa.shutdownWhatsApp();
    server.stop(true);
    process.exit(0);
  });
