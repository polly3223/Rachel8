import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

interface Packet {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string; code?: number };
}

/** Minimal JSONL RPC transport; protocol-specific behavior lives in the provider. */
export class RpcClient {
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly closed: Promise<never>;
  private fail!: (error: Error) => void;
  private dead = false;
  onEvent: (method: string, params: unknown) => void = () => {};
  onRequest: (method: string, params: unknown) => Promise<unknown> = async (method) => {
    throw new Error(`Unsupported server request: ${method}`);
  };
  constructor(
    readonly send: (packet: Packet) => void,
    readonly stop: () => void = () => {},
  ) {
    this.closed = new Promise((_, reject) => {
      this.fail = reject;
    });
    void this.closed.catch(() => {});
  }
  accept(packet: Packet): void {
    if (packet.method) {
      if (packet.id === undefined) this.onEvent(packet.method, packet.params);
      else
        void this.onRequest(packet.method, packet.params)
          .then(
            (result) => this.send({ id: packet.id, result }),
            (error) =>
              this.send({ id: packet.id, error: { code: -32601, message: String(error) } }),
          )
          .catch(() => {});
    } else if (typeof packet.id === "number") {
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      clearTimeout(pending.timer);
      if (packet.error) pending.reject(new Error(packet.error.message));
      else pending.resolve(packet.result);
    }
  }
  async call<T>(method: string, params: unknown, timeout = 90_000): Promise<T> {
    if (this.dead) throw new Error("Codex connection closed");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  close(error = new Error("Codex connection closed")): void {
    if (this.dead) return;
    this.dead = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.fail(error);
    this.stop();
  }
}

export async function connectCodex(cli: string, signal?: AbortSignal): Promise<RpcClient> {
  signal?.throwIfAborted();
  const child = spawn(process.execPath, [cli, "app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new RpcClient(
    (packet) => child.stdin.write(JSON.stringify(packet) + "\n"),
    () => child.kill("SIGTERM"),
  );
  const abort = () => client.close(new DOMException("Stopped", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  // Do not log raw provider stderr: tool arguments and authentication details can appear there.
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      client.accept(JSON.parse(line) as Packet);
    } catch {
      client.close(new Error("Invalid Codex protocol message"));
    }
  });
  child.once("error", (error) => client.close(error));
  child.once("exit", (code) => {
    signal?.removeEventListener("abort", abort);
    client.close(new Error(`Codex exited (${code})`));
  });
  try {
    await client.call("initialize", {
      clientInfo: { name: "rachel8", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    client.send({ method: "initialized", params: {} });
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}
