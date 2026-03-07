import { logger } from "../lib/logger.ts";

const SHARED_FOLDER_PATH = Bun.env["SHARED_FOLDER_PATH"];
const SESSIONS_DIR = SHARED_FOLDER_PATH ? SHARED_FOLDER_PATH : `${import.meta.dir}/../..`;

function getSessionFilePath(provider: "claude" | "codex"): string {
  return `${SESSIONS_DIR}/.${provider}-sessions.json`;
}

function getLegacySessionFilePath(): string {
  return `${SESSIONS_DIR}/.sessions.json`;
}

async function readSessionRecord(path: string): Promise<Record<string, string> | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  const data = await file.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return data as Record<string, string>;
}

export async function loadSessionMap(
  provider: "claude" | "codex",
): Promise<Map<number, string>> {
  const sessions = new Map<number, string>();
  const sessionFile = getSessionFilePath(provider);
  const legacyFile = provider === "claude" ? getLegacySessionFilePath() : null;

  const data =
    (await readSessionRecord(sessionFile)) ??
    (legacyFile ? await readSessionRecord(legacyFile) : null);

  if (!data) {
    return sessions;
  }

  for (const [chatId, sessionId] of Object.entries(data)) {
    sessions.set(Number(chatId), sessionId);
  }

  logger.info(`Loaded ${sessions.size} ${provider} session(s)`);

  if (provider === "claude" && !(await Bun.file(sessionFile).exists()) && legacyFile) {
    await saveSessionMap(provider, sessions);
  }

  return sessions;
}

export async function saveSessionMap(
  provider: "claude" | "codex",
  sessions: Map<number, string>,
): Promise<void> {
  const filePath = getSessionFilePath(provider);
  await Bun.write(filePath, JSON.stringify(Object.fromEntries(sessions)));
}
