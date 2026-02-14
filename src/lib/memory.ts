import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";
import { errorMessage } from "./errors.ts";

const MEMORY_BASE = join(env.SHARED_FOLDER_PATH, "rachel-memory");
const CORE_MEMORY_FILE = join(MEMORY_BASE, "MEMORY.md");
const DAILY_LOGS_DIR = join(MEMORY_BASE, "daily-logs");
const CONTEXT_DIR = join(MEMORY_BASE, "context");

export async function initializeMemorySystem(): Promise<void> {
  try {
    await mkdir(MEMORY_BASE, { recursive: true });
    await mkdir(DAILY_LOGS_DIR, { recursive: true });
    await mkdir(CONTEXT_DIR, { recursive: true });
    logger.info("Memory system initialized");
  } catch (error) {
    logger.error("Failed to initialize memory system", {
      error: errorMessage(error),
    });
  }
}

export async function loadCoreMemory(): Promise<string> {
  try {
    if (existsSync(CORE_MEMORY_FILE)) {
      const content = await readFile(CORE_MEMORY_FILE, "utf-8");
      logger.debug("Core memory loaded", { size: content.length });
      return content;
    }
    logger.debug("No core memory file found");
    return "";
  } catch (error) {
    logger.error("Failed to load core memory", {
      error: errorMessage(error),
    });
    return "";
  }
}

function getTodayLogPath(): { path: string; date: string } {
  const date = new Date().toISOString().split("T")[0]!;
  return { path: join(DAILY_LOGS_DIR, `${date}.md`), date };
}

export async function appendToDailyLog(
  role: "user" | "assistant",
  message: string,
): Promise<void> {
  try {
    const { path: logPath, date: today } = getTodayLogPath();
    const timestamp = new Date().toISOString();
    const entry = `\n## [${timestamp}] ${role === "user" ? "User" : "Rachel"}\n${message}\n`;

    if (!existsSync(logPath)) {
      const header = `# Daily Log: ${today}\n\n## Conversations\n`;
      await writeFile(logPath, header + entry, "utf-8");
      logger.debug("Created new daily log", { date: today });
    } else {
      await appendFile(logPath, entry, "utf-8");
    }
  } catch (error) {
    logger.error("Failed to append to daily log", {
      error: errorMessage(error),
    });
  }
}

export async function updateCoreMemory(content: string): Promise<void> {
  try {
    await writeFile(CORE_MEMORY_FILE, content, "utf-8");
    logger.info("Core memory updated", { size: content.length });
  } catch (error) {
    logger.error("Failed to update core memory", {
      error: errorMessage(error),
    });
  }
}

export async function saveContext(topic: string, content: string): Promise<void> {
  try {
    const contextPath = join(CONTEXT_DIR, `${topic}.md`);
    await writeFile(contextPath, content, "utf-8");
    logger.info("Context saved", { topic });
  } catch (error) {
    logger.error("Failed to save context", {
      topic,
      error: errorMessage(error),
    });
  }
}

export async function loadContext(topic: string): Promise<string> {
  try {
    const contextPath = join(CONTEXT_DIR, `${topic}.md`);
    if (existsSync(contextPath)) {
      return await readFile(contextPath, "utf-8");
    }
    return "";
  } catch (error) {
    logger.error("Failed to load context", {
      topic,
      error: errorMessage(error),
    });
    return "";
  }
}

export async function buildSystemPromptWithMemory(
  basePrompt: string,
): Promise<string> {
  const coreMemory = await loadCoreMemory();

  if (!coreMemory) {
    return basePrompt;
  }

  return `${basePrompt}

## Your Memory
${coreMemory}`;
}
