import { existsSync } from "node:fs";
import { z } from "zod";

export const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-", {
    message: "Must start with 'sk-ant-'. Get your key at https://console.anthropic.com/settings/keys",
  }),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{8,}:[A-Za-z0-9_-]{35,}$/, {
    message:
      "Invalid format. Expected: 123456789:ABCdef... Get yours from @BotFather on Telegram",
  }),
  OWNER_TELEGRAM_USER_ID: z.coerce.number().int().positive({
    message:
      "Must be a positive integer. Send /start to @userinfobot on Telegram to find your user ID",
  }),
  EXA_API_KEY: z.string().min(10, {
    message:
      "Must be at least 10 characters. Get your key at https://dashboard.exa.ai/api-keys",
  }),
  SHARED_FOLDER_PATH: z.string().min(1, {
    message: "Shared folder path is required",
  }),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("production"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Check if .env file exists before attempting validation.
  // Bun silently skips missing .env files, so Zod would fail with
  // cryptic "Required" errors for every field. Catch this early.
  if (!existsSync(".env")) {
    console.log("No .env file found.");
    console.log("Run the setup wizard: bun run setup");
    process.exit(0);
  }

  const result = envSchema.safeParse(Bun.env);

  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nRun the setup wizard to fix: bun run setup");
    process.exit(1);
  }

  return result.data;
}

export const env: Env = loadEnv();
