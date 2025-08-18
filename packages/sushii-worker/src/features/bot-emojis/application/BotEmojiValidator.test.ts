import { describe, expect, it } from "bun:test";
import { readdir, stat } from "fs/promises";
import { join } from "path";

import { BotEmojiName } from "../domain/BotEmojiName";

/**
 * Unit test that validates all PNG files in /emojis/ directory
 * against the requirements for bot emojis.
 */
describe("BotEmojiValidator", () => {
  const emojisDirectory = "./emojis";

  it("should validate all emoji files meet requirements", async () => {
    let files: string[];

    try {
      files = await readdir(emojisDirectory);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        // Emojis directory doesn't exist - skip test
        console.log("Emojis directory not found - skipping validation");
        return;
      }
      throw error;
    }

    const pngFiles = files.filter((f) => f.endsWith(".png"));

    if (pngFiles.length === 0) {
      console.log("No PNG files found in emojis directory");
      return;
    }

    console.log(`Validating ${pngFiles.length} PNG files...`);

    const errors: string[] = [];

    for (const filename of pngFiles) {
      const filePath = join(emojisDirectory, filename);
      const name = filename.replace(/\.png$/, "");

      // Check filename format (lowercase with underscores only)
      if (!/^[a-z0-9_]+$/.test(name)) {
        errors.push(
          `${filename}: Invalid filename format - must be lowercase with underscores only`,
        );
        continue;
      }

      // Check if name exists in BotEmojiName enum
      const parseResult = BotEmojiName.safeParse(name);
      if (!parseResult.success) {
        errors.push(
          `${filename}: Name '${name}' not found in BotEmojiName enum - add it first`,
        );
        continue;
      }

      // Check file size (max 256KB)
      try {
        const stats = await stat(filePath);
        if (stats.size > 256 * 1024) {
          errors.push(
            `${filename}: File too large (${stats.size} bytes, max 256KB)`,
          );
        }
      } catch (error) {
        errors.push(`${filename}: Failed to read file stats - ${error}`);
      }
    }

    if (errors.length > 0) {
      const errorMessage = `Emoji validation failed:\n${errors.join("\n")}`;
      throw new Error(errorMessage);
    }

    console.log(`✅ All ${pngFiles.length} emoji files pass validation`);
  });

  it("should validate emoji name format function", () => {
    const validateEmojiName = (filename: string): boolean => {
      const name = filename.replace(/\.png$/, "");
      return /^[a-z0-9_]+$/.test(name);
    };

    // Valid names
    expect(validateEmojiName("ban.png")).toBe(true);
    expect(validateEmojiName("user_avatar.png")).toBe(true);
    expect(validateEmojiName("arrow_right.png")).toBe(true);
    expect(validateEmojiName("test123.png")).toBe(true);

    // Invalid names
    expect(validateEmojiName("Ban.png")).toBe(false); // Uppercase
    expect(validateEmojiName("user-avatar.png")).toBe(false); // Hyphens
    expect(validateEmojiName("user avatar.png")).toBe(false); // Spaces
    expect(validateEmojiName("user@avatar.png")).toBe(false); // Special chars
    expect(validateEmojiName("émoji.png")).toBe(false); // Unicode
  });
});
