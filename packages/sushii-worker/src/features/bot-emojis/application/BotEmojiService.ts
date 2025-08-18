import type { Client } from "discord.js";
import { readFile } from "fs/promises";
import type { Logger } from "pino";

import type { BotEmojiNameType } from "../domain";

/**
 * Service for Discord API operations related to application emojis.
 */
export class BotEmojiService {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates a new application emoji in Discord.
   */
  async createEmoji(name: BotEmojiNameType, filePath: string): Promise<string> {
    try {
      const buffer = await readFile(filePath);

      // Validate file size (Discord limit is 256KB)
      if (buffer.length > 256 * 1024) {
        throw new Error(
          `Emoji file ${name} is too large: ${buffer.length} bytes (max 256KB)`,
        );
      }

      if (!this.client.application) {
        throw new Error("Client application not available");
      }

      const emoji = await this.client.application.emojis.create({
        attachment: buffer,
        name: name,
      });

      this.logger.info(
        { name, emojiId: emoji.id, fileSize: buffer.length },
        "Created application emoji",
      );

      return emoji.id;
    } catch (error) {
      this.logger.error(
        { err: error, name, filePath },
        "Failed to create application emoji",
      );
      throw error;
    }
  }

  /**
   * Updates an existing application emoji in Discord by deleting and recreating.
   */
  async replaceEmoji(
    name: BotEmojiNameType,
    oldId: string,
    filePath: string,
  ): Promise<string> {
    try {
      // Delete the old emoji first
      await this.deleteEmoji(oldId);

      // Create the new emoji
      const newId = await this.createEmoji(name, filePath);

      this.logger.info({ name, oldId, newId }, "Replaced application emoji");

      return newId;
    } catch (error) {
      this.logger.error(
        { err: error, name, oldId, filePath },
        "Failed to replace application emoji",
      );
      throw error;
    }
  }

  /**
   * Deletes an application emoji from Discord.
   */
  async deleteEmoji(emojiId: string): Promise<void> {
    try {
      if (!this.client.application) {
        throw new Error("Client application not available");
      }

      await this.client.application.emojis.delete(emojiId);

      this.logger.info({ emojiId }, "Deleted application emoji");
    } catch (error) {
      this.logger.error(
        { err: error, emojiId },
        "Failed to delete application emoji",
      );
      throw error;
    }
  }

  /**
   * Gets all application emojis from Discord.
   */
  async getAllDiscordEmojis(): Promise<Map<string, string>> {
    try {
      if (!this.client.application) {
        throw new Error("Client application not available");
      }

      const emojis = await this.client.application.emojis.fetch();
      const emojiMap = new Map<string, string>();

      for (const [id, emoji] of emojis) {
        if (emoji.name) {
          emojiMap.set(emoji.name, id);
        }
      }

      this.logger.debug(
        { count: emojiMap.size },
        "Fetched Discord application emojis",
      );

      return emojiMap;
    } catch (error) {
      this.logger.error(
        { err: error },
        "Failed to fetch Discord application emojis",
      );
      throw error;
    }
  }

  /**
   * Validates emoji filename format (lowercase with underscores).
   */
  validateEmojiName(filename: string): boolean {
    // Remove .png extension
    const name = filename.replace(/\.png$/, "");

    // Check if name contains only lowercase letters, numbers, and underscores
    return /^[a-z0-9_]+$/.test(name);
  }
}
