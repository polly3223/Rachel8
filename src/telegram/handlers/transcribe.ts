// Set env vars BEFORE importing the SDK — it captures them at import time
process.env.ENCLAVE_URL = "https://enclave.cci.prem.io";
process.env.PROXY_URL = "https://proxy.cci.prem.io";

import createRvencClient from "@premai/pcci-sdk-ts";
import { generateEncryptionKeys } from "@premai/pcci-sdk-ts";
import { readFileSync } from "fs";
import { logger } from "../../lib/logger.ts";

const API_KEY = "sk_live_MDE5YzU2NTItZTQyNS03OTkwLTlhZTEtYTJmODcyYjlmMmVhX3BjY2k";

// Cache the client so we don't re-do key exchange every time
let cachedClient: Awaited<ReturnType<typeof createRvencClient>> | null = null;
let clientPromise: Promise<Awaited<ReturnType<typeof createRvencClient>>> | null = null;

async function getClient() {
  if (cachedClient) return cachedClient;

  // Avoid multiple concurrent initializations
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const t0 = performance.now();
    const encryptionKeys = await generateEncryptionKeys();
    cachedClient = await createRvencClient({
      apiKey: API_KEY,
      dekStore: { fileDEKs: {} } as any,
      encryptionKeys,
    });
    const elapsed = (performance.now() - t0).toFixed(0);
    logger.info(`PCCI client initialized in ${elapsed}ms`);
    return cachedClient;
  })();

  return clientPromise;
}

// Pre-warm the client on import so first transcription is fast
getClient().catch((err) => {
  logger.warn("Failed to pre-warm PCCI client", {
    error: err instanceof Error ? err.message : String(err),
  });
  // Reset so next call retries
  clientPromise = null;
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
