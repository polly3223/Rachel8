/**
 * Memory management system for Rachel8
 *
 * Implements persistent memory using markdown files following 2026 best practices:
 * - Core memory (MEMORY.md) for persistent facts and preferences
 * - Daily logs for conversation history
 * - Context-specific knowledge organization
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

const MEMORY_BASE = join(env.SHARED_FOLDER_PATH, "rachel-memory");
const CORE_MEMORY_FILE = join(MEMORY_BASE, "MEMORY.md");
const DAILY_LOGS_DIR = join(MEMORY_BASE, "daily-logs");
const CONTEXT_DIR = join(MEMORY_BASE, "context");

/**
 * Ensures memory directory structure exists
 */
export async function initializeMemorySystem(): Promise<void> {
  try {
    if (!existsSync(MEMORY_BASE)) {
      await mkdir(MEMORY_BASE, { recursive: true });
      await mkdir(DAILY_LOGS_DIR, { recursive: true });
      await mkdir(CONTEXT_DIR, { recursive: true });
      logger.info("Memory system initialized");
    }
  } catch (error) {
    logger.error("Failed to initialize memory system", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Loads core memory content
 */
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
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

/**
 * Gets today's daily log file path
 */
function getTodayLogPath(): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return join(DAILY_LOGS_DIR, `${today}.md`);
}

/**
 * Appends an entry to today's log
 */
export async function appendToDailyLog(
  role: "user" | "assistant",
  message: string,
): Promise<void> {
  try {
    const logPath = getTodayLogPath();
    const timestamp = new Date().toISOString();
    const entry = `\n## [${timestamp}] ${role === "user" ? "User" : "Rachel"}\n${message}\n`;

    // Create log file with header if it doesn't exist
    if (!existsSync(logPath)) {
      const today = new Date().toISOString().split("T")[0];
      const header = `# Daily Log: ${today}\n\n## Conversations\n`;
      await writeFile(logPath, header + entry, "utf-8");
      logger.debug("Created new daily log", { date: today });
    } else {
      // Append to existing log
      const existing = await readFile(logPath, "utf-8");
      await writeFile(logPath, existing + entry, "utf-8");
    }
  } catch (error) {
    logger.error("Failed to append to daily log", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Updates core memory with new information
 * This should be called deliberately when important facts emerge
 */
export async function updateCoreMemory(content: string): Promise<void> {
  try {
    await writeFile(CORE_MEMORY_FILE, content, "utf-8");
    logger.info("Core memory updated", { size: content.length });
  } catch (error) {
    logger.error("Failed to update core memory", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Saves context-specific knowledge
 */
export async function saveContext(topic: string, content: string): Promise<void> {
  try {
    const contextPath = join(CONTEXT_DIR, `${topic}.md`);
    await writeFile(contextPath, content, "utf-8");
    logger.info("Context saved", { topic });
  } catch (error) {
    logger.error("Failed to save context", {
      topic,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Loads context-specific knowledge
 */
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
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

/**
 * Builds enhanced system prompt with memory context
 */
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
