import { existsSync, unlinkSync } from "fs";
import { logger } from "../../lib/logger.ts";

// whisper.cpp local transcription
// Base model with auto language detection (supports English + Italian)
const WHISPER_MODEL = process.env["WHISPER_MODEL"] ?? "base";
const WHISPER_DIR = process.env["WHISPER_DIR"] ?? "/usr/local/share/whisper";
const WHISPER_THREADS = process.env["WHISPER_THREADS"] ?? "2";

function getModelPath(): string {
  return `${WHISPER_DIR}/ggml-${WHISPER_MODEL}.bin`;
}

function getWhisperBinary(): string {
  return `${WHISPER_DIR}/whisper-cli`;
}

// Validate whisper is installed on startup
const binary = getWhisperBinary();
const model = getModelPath();
if (existsSync(binary) && existsSync(model)) {
  logger.info(`whisper.cpp ready: model=${WHISPER_MODEL}, binary=${binary}`);
} else {
  logger.warn("whisper.cpp not found — voice transcription will fail", {
    binary: existsSync(binary),
    model: existsSync(model),
  });
}

/** Convert audio to 16kHz mono WAV (required by whisper.cpp) */
async function convertToWav(inputPath: string): Promise<string> {
  const wavPath = inputPath.replace(/\.[^.]+$/, ".wav");

  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
    { stdout: "pipe", stderr: "pipe" },
  );

  const result = await proc.exited;
  if (result !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg conversion failed: ${stderr}`);
  }

  return wavPath;
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const t0 = performance.now();

  // Convert to WAV
  const wavPath = await convertToWav(filePath);

  try {
    const proc = Bun.spawn(
      [
        binary,
        "-m", model,
        "-f", wavPath,
        "-t", WHISPER_THREADS,
        "--no-timestamps",
        "-l", "auto",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (result !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`whisper.cpp failed (exit ${result}): ${stderr}`);
    }

    // Parse stdout — whisper outputs text lines, filter out empty and system lines
    const text = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("whisper_"))
      .join(" ")
      .trim();

    const elapsed = (performance.now() - t0).toFixed(0);
    logger.info(`STT completed in ${elapsed}ms`, {
      filePath,
      model: WHISPER_MODEL,
      textLength: text.length,
    });

    return text;
  } finally {
    // Clean up WAV
    if (existsSync(wavPath)) unlinkSync(wavPath);
  }
}
