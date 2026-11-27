import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileMethod } from "./delivery.ts";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_SPEED,
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  MAX_SPEAK_CHARS,
  loadElevenLabsKey,
  resolveAmbientPath,
  resolveSpeed,
  synthesizeSpeech,
} from "./voice.ts";

describe("fileMethod voice routing", () => {
  test("routes ogg/oga/opus to sendVoice unless original=true", () => {
    expect(fileMethod("/tmp/reply.ogg")).toBe("sendVoice");
    expect(fileMethod("/tmp/reply.OGA")).toBe("sendVoice");
    expect(fileMethod("/tmp/reply.opus")).toBe("sendVoice");
    expect(fileMethod("/tmp/reply.ogg", true)).toBe("sendDocument");
    expect(fileMethod("/tmp/sample.mp3")).toBe("sendAudio");
  });
});

describe("loadElevenLabsKey", () => {
  test("prefers explicit env key over vault file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rachel-voice-"));
    try {
      mkdirSync(join(dir, "vault"), { recursive: true });
      await Bun.write(join(dir, "vault", "elevenlabs.json"), JSON.stringify({ api_key: "sk_vault" }));
      expect(await loadElevenLabsKey(dir, "sk_env")).toBe("sk_env");
      expect(await loadElevenLabsKey(dir, "")).toBe("sk_vault");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws clear error when no key is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rachel-voice-empty-"));
    try {
      await expect(loadElevenLabsKey(dir, "")).rejects.toThrow("ElevenLabs API key not configured");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("speed and ambient resolution", () => {
  test("defaults speed to 1.15 and rejects out-of-range values", () => {
    expect(resolveSpeed(undefined, undefined)).toBe(DEFAULT_ELEVENLABS_SPEED);
    expect(resolveSpeed(1.2, undefined)).toBe(1.2);
    expect(resolveSpeed(undefined, "1.05")).toBe(1.05);
    expect(() => resolveSpeed(1.5, undefined)).toThrow("Invalid ElevenLabs voice speed");
    expect(() => resolveSpeed(0.5, undefined)).toThrow("Invalid ElevenLabs voice speed");
  });

  test("resolves shared ambient file when present and respects off/none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rachel-amb-"));
    try {
      expect(await resolveAmbientPath(dir, undefined)).toBeNull();
      mkdirSync(join(dir, "voice"), { recursive: true });
      const file = join(dir, "voice", "ambient-office.mp3");
      await Bun.write(file, "stub");
      expect(await resolveAmbientPath(dir, undefined)).toBe(file);
      expect(await resolveAmbientPath(dir, "off")).toBeNull();
      expect(await resolveAmbientPath(dir, "none")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("synthesizeSpeech", () => {
  test("calls ElevenLabs TTS with opus_48000_64, speed 1.15, and parses character-cost", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeOgg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, ...new Array(32).fill(1)]);
    const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(fakeOgg, {
        status: 200,
        headers: { "Content-Type": "audio/opus", "character-cost": "12" },
      });
    }) as typeof fetch;

    const result = await synthesizeSpeech("  Ciao Lorenzo!  ", {
      apiKey: "sk_test_dummy",
      fetchImpl: mockFetch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_ELEVENLABS_VOICE_ID}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      text: "Ciao Lorenzo!",
      model_id: DEFAULT_ELEVENLABS_MODEL_ID,
      voice_settings: { speed: DEFAULT_ELEVENLABS_SPEED },
    });
    expect(result.speed).toBe(DEFAULT_ELEVENLABS_SPEED);
    expect(result.characters).toBe(13);
    expect(result.creditsUsed).toBe(12);
    expect(result.audio.byteLength).toBe(fakeOgg.byteLength);
  });

  test("rejects empty or oversized text before calling network", async () => {
    let called = false;
    const mockFetch = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;

    await expect(synthesizeSpeech("   ", { apiKey: "sk_x", fetchImpl: mockFetch })).rejects.toThrow(
      "cannot be empty",
    );
    await expect(
      synthesizeSpeech("a".repeat(MAX_SPEAK_CHARS + 1), { apiKey: "sk_x", fetchImpl: mockFetch }),
    ).rejects.toThrow("exceeds");
    expect(called).toBe(false);
  });

  test("propagates HTTP failure without leaking api key", async () => {
    const secret = "sk_super_secret_should_not_appear";
    const mockFetch = (async () =>
      new Response("quota exceeded", { status: 402 })) as unknown as typeof fetch;
    try {
      await synthesizeSpeech("Hello", { apiKey: secret, fetchImpl: mockFetch });
      throw new Error("expected throw");
    } catch (err) {
      const msg = String(err);
      expect(msg).toContain("HTTP 402");
      expect(msg).not.toContain(secret);
    }
  });
});
