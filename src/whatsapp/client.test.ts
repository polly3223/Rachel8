import { expect, test } from "bun:test";

test("fresh-process disconnect reaches the linked account and preserves credentials when logout fails", async () => {
  // Isolate the socket mock so other tests still use the real Baileys message decoder.
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./scripts/test-env.ts",
      "--eval",
      `
    import { mock } from "bun:test";
    import { EventEmitter } from "node:events";
    import { mkdir } from "node:fs/promises";
    const baileys = await import("baileys");
    const directory = Bun.env.SHARED_FOLDER_PATH + "/rachel-memory/whatsapp-auth";
    await mkdir(directory, {recursive:true});
    await Bun.write(directory + "/creds.json", "{}");
    let logouts = 0, fail = true;
    mock.module("baileys", () => ({ ...baileys,
      useMultiFileAuthState: async () => ({ state:{creds:{registered:true}}, saveCreds: async () => {
        await Bun.sleep(20); await Bun.write(directory + "/creds.json", "{}");
      }}),
      default: () => {
        const ev = new EventEmitter();
        queueMicrotask(() => { ev.emit("creds.update", {}); ev.emit("connection.update", {connection:"open"}); });
        return {ev, logout: async () => { logouts++; if (fail) throw new Error("offline"); }, end: () => {}};
      }
    }));
    const client = await import("./src/whatsapp/client.ts");
    let rejected = false;
    try { await client.disconnect(); } catch { rejected = true; }
    if (!rejected || logouts !== 1 || !(await Bun.file(directory + "/creds.json").exists())) throw new Error("Failed logout must retain credentials");
    fail = false; await client.disconnect(); await Bun.sleep(30);
    if (logouts !== 2 || await Bun.file(directory + "/creds.json").exists()) throw new Error("Logout did not remove credentials durably");
    client.shutdownWhatsApp();
    console.log("verified");
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
  expect(output).toContain("verified");
});
