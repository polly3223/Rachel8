import { describe, test, expect } from "bun:test";
import {
  validateAnthropicKey,
  validateTelegramToken,
  validateExaKey,
  validateFolderPath,
} from "./validate.ts";

describe("validateAnthropicKey", () => {
  test("accepts valid key format", () => {
    expect(
      validateAnthropicKey("sk-ant-api03-abc123_DEF-456"),
    ).toBeUndefined();
  });

  test("accepts key with long body", () => {
    expect(
      validateAnthropicKey(
        "sk-ant-api03-aaaaaaaaaa_BBBBBBB-CCCCCCCC_1234567890",
      ),
    ).toBeUndefined();
  });

  test("rejects empty string", () => {
    expect(validateAnthropicKey("")).toBe("API key is required");
  });

  test("rejects undefined", () => {
    expect(validateAnthropicKey(undefined)).toBe("API key is required");
  });

  test("rejects wrong prefix", () => {
    expect(validateAnthropicKey("sk-ant-abc123")).toBe(
      "Invalid format. Claude API keys start with sk-ant-api03-",
    );
  });

  test("rejects prefix only (no body)", () => {
    expect(validateAnthropicKey("sk-ant-api03-")).toBe(
      "Invalid format. Claude API keys start with sk-ant-api03-",
    );
  });

  test("rejects arbitrary string", () => {
    expect(validateAnthropicKey("invalid")).toBe(
      "Invalid format. Claude API keys start with sk-ant-api03-",
    );
  });

  test("rejects key with spaces", () => {
    expect(validateAnthropicKey("sk-ant-api03-abc def")).toBe(
      "Invalid format. Claude API keys start with sk-ant-api03-",
    );
  });
});

describe("validateTelegramToken", () => {
  test("accepts valid token format", () => {
    expect(
      validateTelegramToken(
        "123456789:ABCdefGHIjklMNOpqrstuvwxyz1234567890",
      ),
    ).toBeUndefined();
  });

  test("accepts token with underscore and hyphen", () => {
    expect(
      validateTelegramToken(
        "99887766:ABCDEFGHIJ_klmnopqrst-uvwxyz12345678",
      ),
    ).toBeUndefined();
  });

  test("rejects empty string", () => {
    expect(validateTelegramToken("")).toBe("Bot token is required");
  });

  test("rejects undefined", () => {
    expect(validateTelegramToken(undefined)).toBe("Bot token is required");
  });

  test("rejects short bot ID", () => {
    expect(validateTelegramToken("short:ABCdefGHIjklMNOpqrstuvwxyz12345")).toBe(
      "Invalid format. Telegram tokens look like 123456789:ABCdef... (get one from @BotFather)",
    );
  });

  test("rejects non-numeric bot ID", () => {
    expect(
      validateTelegramToken("notanumber:ABCdefGHIjklMNOpqrstuvwxyz12345"),
    ).toBe(
      "Invalid format. Telegram tokens look like 123456789:ABCdef... (get one from @BotFather)",
    );
  });

  test("rejects token with short body", () => {
    expect(validateTelegramToken("123456789:abc")).toBe(
      "Invalid format. Telegram tokens look like 123456789:ABCdef... (get one from @BotFather)",
    );
  });

  test("rejects token without colon", () => {
    expect(validateTelegramToken("123456789ABCdefGHIjklMNOpqrstuvwxyz12345")).toBe(
      "Invalid format. Telegram tokens look like 123456789:ABCdef... (get one from @BotFather)",
    );
  });
});

describe("validateExaKey", () => {
  test("accepts valid key (10+ chars)", () => {
    expect(validateExaKey("abcdefghij")).toBeUndefined();
  });

  test("accepts long key", () => {
    expect(
      validateExaKey("abcdefghijklmnopqrstuvwxyz1234567890"),
    ).toBeUndefined();
  });

  test("rejects empty string", () => {
    expect(validateExaKey("")).toBe("API key is required");
  });

  test("rejects undefined", () => {
    expect(validateExaKey(undefined)).toBe("API key is required");
  });

  test("rejects short string (< 10 chars)", () => {
    expect(validateExaKey("short")).toBe(
      "Invalid format. Exa API keys are at least 10 characters",
    );
  });

  test("rejects 9-character string", () => {
    expect(validateExaKey("123456789")).toBe(
      "Invalid format. Exa API keys are at least 10 characters",
    );
  });

  test("accepts exactly 10 characters", () => {
    expect(validateExaKey("1234567890")).toBeUndefined();
  });
});

describe("validateFolderPath", () => {
  test("accepts absolute path", () => {
    expect(validateFolderPath("/data/shared/vault")).toBeUndefined();
  });

  test("accepts root path", () => {
    expect(validateFolderPath("/")).toBeUndefined();
  });

  test("accepts nested absolute path", () => {
    expect(validateFolderPath("/home/user/documents")).toBeUndefined();
  });

  test("rejects empty string", () => {
    expect(validateFolderPath("")).toBe("Folder path is required");
  });

  test("rejects undefined", () => {
    expect(validateFolderPath(undefined)).toBe("Folder path is required");
  });

  test("rejects relative path", () => {
    expect(validateFolderPath("relative/path")).toBe(
      "Path must be absolute (start with /)",
    );
  });

  test("rejects path starting with ~", () => {
    expect(validateFolderPath("~/documents")).toBe(
      "Path must be absolute (start with /)",
    );
  });
});
