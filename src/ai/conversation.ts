export type ConversationKey = number | string;

export function normalizeConversationKey(key: ConversationKey): string {
  return String(key);
}
