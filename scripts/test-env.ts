import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Tests never inherit the live bot's state or credentials.
Bun.env["SHARED_FOLDER_PATH"] = mkdtempSync(join(tmpdir(), "rachel8-test-"));
Bun.env["TELEGRAM_BOT_TOKEN"] = "123456789:" + "test".repeat(10);
Bun.env["OWNER_TELEGRAM_USER_ID"] = "123456789";
Bun.env["NODE_ENV"] = "test";
