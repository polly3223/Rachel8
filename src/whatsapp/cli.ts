#!/usr/bin/env bun
import { resolve } from "node:path";

const [action, ...args] = process.argv.slice(2);
if (!action) {
  console.log(
    "WhatsApp: connect <phone> | connect-qr | status | groups | contacts <group> | messages <chat> [n] | search <contact> | search-messages <text> | send <to> <text> | send-file <to> <path> [caption] | disconnect",
  );
  process.exit(0);
}
const socketPath =
  Bun.env["RACHEL_WHATSAPP_SOCKET"] ?? `/run/user/${process.getuid?.()}/rachel8-whatsapp.sock`;
async function request(action: string, args: string[] = []): Promise<unknown> {
  const response = await fetch("http://localhost/", {
    unix: socketPath,
    method: "POST",
    body: JSON.stringify({ action, args }),
    signal: AbortSignal.timeout(125_000),
  });
  const data = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok) throw new Error(data.error ?? "WhatsApp bridge request failed");
  return data.result;
}
try {
  await request("status");
} catch {
  if (action === "status") {
    console.log("WhatsApp bridge is stopped.");
    process.exit(0);
  }
  const child = Bun.spawn(
    [
      "systemd-run",
      "--user",
      "--collect",
      "--unit=rachel8-whatsapp",
      "--property=Restart=on-failure",
      `--working-directory=${resolve(import.meta.dir, "../..")}`,
      `--setenv=SHARED_FOLDER_PATH=${Bun.env["SHARED_FOLDER_PATH"] ?? ""}`,
      process.execPath,
      resolve(import.meta.dir, "bridge.ts"),
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const error = await new Response(child.stderr).text();
  if (await child.exited) throw new Error(`Could not start the WhatsApp service: ${error}`);
  for (let i = 0; i < 30; i++) {
    try {
      await request("status");
      break;
    } catch {
      await Bun.sleep(200);
    }
  }
}
const result = await request(action, args);
console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
if (action === "connect" || action === "connect-qr") {
  console.log(
    "Use WhatsApp → Settings → Linked Devices to finish linking. Waiting up to 120 seconds.",
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (((await request("status")) as { status: string }).status === "connected") {
      console.log("WhatsApp connected; the bridge stays running.");
      process.exit(0);
    }
    await Bun.sleep(1000);
  }
  throw new Error("Linking timed out; request a fresh QR/pairing code");
}
