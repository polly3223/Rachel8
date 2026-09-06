import { expect, test } from "bun:test";
import { WhatsAppStore } from "./store.ts";

test("historical messages remain searchable after closing and reopening the bridge", () => {
  const path = `${Bun.env["SHARED_FOLDER_PATH"]}/whatsapp-reload.db`;
  const first = new WhatsAppStore(path);
  first.messages([
    {
      key: { remoteJid: "3912345678@s.whatsapp.net", id: "saved" },
      message: { conversation: "Delivery Tuesday" },
      messageTimestamp: 42,
    },
  ]);
  first.db.close();
  const second = new WhatsAppStore(path);
  expect(second.search("Tuesday")).toHaveLength(1);
  expect(second.recent("+3912345678")).toHaveLength(1);
  second.db.close();
});

test("history sync and live events use the same deduplicated searchable store", () => {
  const store = new WhatsAppStore(":memory:");
  store.contacts([{ id: "123@s.whatsapp.net", name: "Test" }]);
  const message = {
    key: { remoteJid: "123@s.whatsapp.net", id: "m1", fromMe: false },
    message: { conversation: "Remember the blue bicycle" },
    messageTimestamp: 42,
  };
  store.messages([message]);
  store.messages([message]);
  expect(store.recent("Test")).toHaveLength(1);
  expect(store.search("blue bicycle")).toHaveLength(1);
  store.messages([{ ...message, message: { conversation: "Actually a red bicycle" } }]);
  expect(store.search("blue")).toHaveLength(0);
  expect(store.search("red")).toHaveLength(1);
});
test("ambiguous names cannot send to an arbitrary match", () => {
  const store = new WhatsAppStore(":memory:");
  store.contacts([
    { id: "123@s.whatsapp.net", name: "Test" },
    { id: "456@s.whatsapp.net", name: "Test" },
  ]);
  expect(() => store.resolve("Test")).toThrow("ambiguous");
  expect(store.resolve("+3912345678")).toBe("3912345678@s.whatsapp.net");
});
