import { describe, test, expect } from "bun:test";
import {
  validateTelegramToken,
  validateFolderPath,
} from "./validate.ts";

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
