import createRvencClient from "@premai/pcci-sdk-ts";
import { generateEncryptionKeys } from "@premai/pcci-sdk-ts";
import { readFileSync } from "fs";
import { logger } from "../../lib/logger.ts";

const API_KEY = "sk_live_MDE5YzU2NTItZTQyNS03OTkwLTlhZTEtYTJmODcyYjlmMmVhX3BjY2k";

// Cache the client so we don't re-do key exchange every time
let cachedClient: Awaited<ReturnType<typeof createRvencClient>> | null = null;

async function getClient() {
  if (cachedClient) return cachedClient;

  process.env.ENCLAVE_URL = "https://enclave.cci.prem.io";
  process.env.PROXY_URL = "https://proxy.cci.prem.io";

  const encryptionKeys = await generateEncryptionKeys();
  cachedClient = await createRvencClient({
    apiKey: API_KEY,
    dekStore: { fileDEKs: {} } as any,
    encryptionKeys,
  });

  return cachedClient;
}

// Pre-warm the client on import so first transcription is fast
getClient().catch((err) => {
  logger.warn("Failed to pre-warm PCCI client", {
    error: err instanceof Error ? err.message : String(err),
  });
});

export async function transcribeAudio(filePath: string): Promise<string> {
  const t0 = performance.now();

  const client = await getClient();
  const fileBuffer = readFileSync(filePath);
  const fileName = filePath.split("/").pop() || "audio.ogg";
  const file = new File([fileBuffer], fileName);

  const transcription = await client.audio.transcriptions.create({
    file,
    model: "openai/whisper-large-v3",
  });

  const elapsed = (performance.now() - t0).toFixed(0);
  logger.info(`STT completed in ${elapsed}ms`, { filePath, textLength: transcription.text.length });

  return transcription.text.trim();
}
