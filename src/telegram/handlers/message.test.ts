import { test, expect } from "bun:test";
import { Context } from "grammy";
import type { Message, UserFromGetMe } from "grammy/types";
import {
  acceptMessage,
  buildInput,
  messageTime,
  NATIVE_AUDIO_MAX_SECONDS,
  NATIVE_MEDIA_MAX_BYTES,
  NATIVE_VIDEO_MAX_SECONDS,
  useNativeMedia,
} from "./message.ts";
import { getStore } from "../../ai/session-store.ts";
import { telegram } from "../delivery.ts";
import { bot } from "../bot.ts";

const owner = 123456789;
const me: UserFromGetMe = {
  id: 12345,
  is_bot: true,
  first_name: "Test",
  username: "test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const message = (id: number, text = "") => ({
  message_id: id,
  date: 1788715620,
  chat: { id: owner, type: "private" as const, first_name: "Owner" },
  from: { id: owner, is_bot: false, first_name: "Owner" },
  text,
});

test("the prompt keeps the Telegram send time and the quoted decision", async () => {
  const original = message(101, "Use the blue background");
  const followup = {
    ...message(102, "Apply that choice"),
    reply_to_message: { ...original, reply_to_message: undefined },
  };
  const input = await buildInput({ messages: [followup] });
  expect(input.text).toContain("Use the blue background");
  expect(input.text).toContain("Apply that choice");
  expect(input.text).toContain(messageTime(original.date));
  expect(input.text).toContain("Telegram message 101");
});
test("replies to rich messages retain structured formatted text as context", async () => {
  const original: Message.RichMessageMessage = {
    message_id: 103, date: 1788715620, chat: message(103).chat,
    rich_message: { blocks: [
      { type: "heading", size: 2, text: "Results" },
      { type: "paragraph", text: { type: "bold", text: "Use Sonnet" } },
    ] },
  };
  const input = await buildInput({ messages: [{
    ...message(104, "Use that one"), reply_to_message: { ...original, reply_to_message: undefined },
  }] });
  expect(input.text).toContain("Quoted message (context)");
  expect(input.text).toContain("Telegram message 103");
  expect(input.text).toContain("Use Sonnet");
  expect(input.text).toContain('"type":"bold"');
});
test("album intake is durable and deduplicated before any media processing", () => {
  const photo = (id: number) =>
    new Context(
      {
        update_id: id,
        message: {
          ...message(id),
          photo: [{ file_id: `photo-${id}`, file_unique_id: `u${id}`, width: 10, height: 10 }],
          media_group_id: "album-test",
        },
      },
      telegram,
      me,
    );
  acceptMessage(photo(200));
  acceptMessage(photo(201));
  acceptMessage(photo(200));
  const runs = getStore()
    .recent(20)
    .filter((r) => r.body.includes("album-test"));
  expect(runs).toHaveLength(1);
  expect(JSON.parse(runs[0]!.body).messages).toHaveLength(2);
  expect(runs[0]?.state).toBe("queued");
});
test("Telegram command intake completes even while work is recorded as running", async () => {
  bot.botInfo = me;
  let replied = false;
  bot.api.config.use(async (_prev, method) => {
    if (method === "sendMessage") replied = true;
    return { ok: true, result: message(333, "status") } as never;
  });
  const run = getStore().enqueue("telegram", String(owner), { messages: [] });
  getStore().db.run(
    "UPDATE runs SET state='running',activity='Waiting on a slow tool' WHERE id=?",
    [run.id],
  );
  const update = {
    update_id: 300,
    message: {
      ...message(300, "/status"),
      entities: [{ type: "bot_command" as const, offset: 0, length: 7 }],
    },
  };
  await bot.handleUpdate(update);
  expect(replied).toBe(true);
  expect(getStore().get(run.id)?.state).toBe("running");
});
test("credential masking cannot corrupt a persisted JSON envelope", () => {
  const secret = "sk-proj-" + "a".repeat(40);
  const incoming = new Context(
    { update_id: 400, message: message(400, `Use api_key="${secret}" for this task`) },
    telegram,
    me,
  );
  acceptMessage(incoming);
  const run = getStore().recent(1)[0]!;
  expect(() => JSON.parse(run.body)).not.toThrow();
  expect(run.body).not.toContain(secret);
});
test("status keeps older active work visible and splits a full queue into valid Telegram messages", async () => {
  bot.botInfo = me;
  const sent: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage") sent.push((payload as { text: string }).text);
    return { ok: true, result: message(444) } as never;
  });
  const store = getStore();
  const old = store.enqueue("task", "old-worker", {});
  store.db.run("UPDATE runs SET state='running' WHERE id=?", [old.id]);
  const queued = Array.from({ length: 32 }, (_, i) => store.enqueue("task", `worker-${i}-${"x".repeat(100)}`, {}));
  await bot.handleUpdate({ update_id: 500, message: { ...message(500, "/status"), entities: [{ type: "bot_command", offset: 0, length: 7 }] } });
  expect(sent.length).toBeGreaterThan(1);
  expect(sent.every((text) => text.length <= 4096)).toBe(true);
  expect(sent.join("\n")).toContain(`#${old.id} old-worker: running`);
  for (const run of [old, ...queued]) store.finish(run.id, "succeeded", { text: "" });
});

test("useNativeMedia enables native audio/video only on Antigravity within duration and size limits", () => {
  expect(useNativeMedia("audio", "antigravity", 45, 50_000)).toBe(true);
  expect(useNativeMedia("audio", "antigravity", NATIVE_AUDIO_MAX_SECONDS, NATIVE_MEDIA_MAX_BYTES)).toBe(true);
  expect(useNativeMedia("audio", "antigravity", NATIVE_AUDIO_MAX_SECONDS + 1, 50_000)).toBe(false);
  expect(useNativeMedia("audio", "antigravity", 30, NATIVE_MEDIA_MAX_BYTES + 1)).toBe(false);
  expect(useNativeMedia("audio", "codex", 10, 10_000)).toBe(false);
  expect(useNativeMedia("audio", "claudecode", 10, 10_000)).toBe(false);
  expect(useNativeMedia("video", "antigravity", NATIVE_VIDEO_MAX_SECONDS, 2_000_000)).toBe(true);
  expect(useNativeMedia("video", "antigravity", NATIVE_VIDEO_MAX_SECONDS + 1, 2_000_000)).toBe(false);
  expect(useNativeMedia("video", "codex", 10, 1_000_000)).toBe(false);
});

test("Antigravity skips Groq transcription for short voice notes and instructs native read_file", async () => {
  let transcribed = 0;
  const voiceMsg = {
    ...message(601),
    text: undefined,
    voice: { file_id: "voice-short", file_unique_id: "vs1", duration: 42, file_size: 80_000 },
  } as unknown as Message;
  const input = await buildInput({ messages: [voiceMsg] }, undefined, {
    provider: "antigravity",
    download: async (_id, name) => `/shared/telegram-files/${name}`,
    transcribe: async () => {
      transcribed += 1;
      return "should not run";
    },
  });
  expect(transcribed).toBe(0);
  expect(input.text).toContain("Attachment saved at: /shared/telegram-files/voice.ogg");
  expect(input.text).toContain("Native audio attachment (42s): call read_file on /shared/telegram-files/voice.ogg");
  expect(input.text).not.toContain("Audio transcript");
});

test("Antigravity falls back to Groq transcription for long or oversized audio recordings", async () => {
  const calls: string[] = [];
  const longAudio = {
    ...message(602),
    text: undefined,
    audio: { file_id: "audio-long", file_unique_id: "al1", duration: 750, file_name: "meeting.mp3", file_size: 5_000_000 },
  } as unknown as Message;
  const oversizedDoc = {
    ...message(603),
    text: undefined,
    document: { file_id: "audio-big", file_unique_id: "ab1", file_name: "export.m4a", mime_type: "audio/mp4" },
  } as unknown as Message;
  const input = await buildInput({ messages: [longAudio, oversizedDoc] }, undefined, {
    provider: "antigravity",
    download: async (_id, name) => `/shared/telegram-files/${name}`,
    fileSize: async () => NATIVE_MEDIA_MAX_BYTES + 1024,
    transcribe: async (path) => {
      calls.push(path);
      return `transcript for ${path}`;
    },
  });
  expect(calls).toEqual(["/shared/telegram-files/meeting.mp3", "/shared/telegram-files/export.m4a"]);
  expect(input.text).toContain("Audio transcript (Groq fallback for long audio, 12m 30s): transcript for /shared/telegram-files/meeting.mp3");
  expect(input.text).toContain("Audio transcript (Groq fallback for long audio): transcript for /shared/telegram-files/export.m4a");
});

test("Non-Antigravity providers keep Groq transcription for short voice messages", async () => {
  let transcribed = 0;
  const voiceMsg = {
    ...message(604),
    text: undefined,
    voice: { file_id: "voice-codex", file_unique_id: "vc1", duration: 15, file_size: 20_000 },
  } as unknown as Message;
  const input = await buildInput({ messages: [voiceMsg] }, undefined, {
    provider: "codex",
    download: async (_id, name) => `/shared/telegram-files/${name}`,
    transcribe: async () => {
      transcribed += 1;
      return "hello from whisper";
    },
  });
  expect(transcribed).toBe(1);
  expect(input.text).toContain("Audio transcript: hello from whisper");
  expect(input.text).not.toContain("Native audio attachment");
});

test("Antigravity routes short videos natively via read_file and flags oversized videos", async () => {
  let transcribed = 0;
  const shortVideo = {
    ...message(605),
    text: undefined,
    video_note: { file_id: "vn-short", file_unique_id: "vn1", length: 240, duration: 18, file_size: 900_000 },
  } as unknown as Message;
  const longVideo = {
    ...message(606),
    text: undefined,
    video: { file_id: "vid-long", file_unique_id: "vl1", width: 1280, height: 720, duration: 420, file_name: "demo.mp4", file_size: 4_000_000 },
  } as unknown as Message;
  const input = await buildInput({ messages: [shortVideo, longVideo] }, undefined, {
    provider: "antigravity",
    download: async (_id, name) => `/shared/telegram-files/${name}`,
    transcribe: async () => {
      transcribed += 1;
      return "unused";
    },
  });
  expect(transcribed).toBe(0);
  expect(input.text).toContain("Native video attachment (18s): call read_file on /shared/telegram-files/video-note.mp4");
  expect(input.text).toContain("Video attachment (7m 0s) exceeds the inline native limit");
});
