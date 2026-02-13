import { readFileSync } from "fs";
import { logger } from "../../lib/logger.ts";

const API_KEY = "sk_live_MDE5YzU2NTItZTQyNS03OTkwLTlhZTEtYTJmODcyYjlmMmVhX3BjY2k";
const ENCLAVE_URL = "https://enclave.cci.prem.io";
const PROXY_URL = "https://proxy.cci.prem.io";

// Cache the client so we don't re-do key exchange every time
let cachedClient: any = null;
let clientPromise: Promise<any> | null = null;

async function getClient() {
  if (cachedClient) return cachedClient;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const t0 = performance.now();

    // Dynamic import so we can set env vars first
    process.env.ENCLAVE_URL = ENCLAVE_URL;
    process.env.PROXY_URL = PROXY_URL;
    const { default: createRvencClient, generateEncryptionKeys } = await import("@premai/pcci-sdk-ts");

    const encryptionKeys = await generateEncryptionKeys();
    cachedClient = await createRvencClient({
      apiKey: API_KEY,
      dekStore: { fileDEKs: {} } as any,
      encryptionKeys,
      config: {
        endpoints: {
          enclave: ENCLAVE_URL,
          proxy: PROXY_URL,
        },
      },
    });
    const elapsed = (performance.now() - t0).toFixed(0);
    logger.info(`PCCI client initialized in ${elapsed}ms`);
    return cachedClient;
  })();

  return clientPromise;
}

// Pre-warm the client on startup
getClient().catch((err) => {
  logger.warn("Failed to pre-warm PCCI client", {
    error: err instanceof Error ? err.message : String(err),
  });
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
