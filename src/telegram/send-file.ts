#!/usr/bin/env bun
import { sendArtifact } from "./delivery.ts";
import { env } from "../config/env.ts";

const args = process.argv.slice(2);
const original = args.includes("--original");
const [path, ...caption] = args.filter((a) => a !== "--original");
if (!path)
  throw new Error("Usage: bun run src/telegram/send-file.ts <path> [caption] [--original]");
const id = await sendArtifact(
  env.OWNER_TELEGRAM_USER_ID,
  path,
  caption.join(" ") || undefined,
  original,
);
console.log(`File delivered (Telegram message ${id}).`);
