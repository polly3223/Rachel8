import { test, expect } from "bun:test";
import { Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { acceptMessage, buildInput, messageTime } from "./message.ts";
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
