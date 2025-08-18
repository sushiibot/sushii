import { createHash } from "crypto";
import type { Client } from "discord.js";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import type { Logger } from "pino";

import type { WebhookService } from "@/features/webhook-logging/infrastructure/WebhookService";

import { BotEmojiName, type BotEmojiNameType } from "../domain";
import { BotEmoji } from "../domain/entities/BotEmoji";
import type { BotEmojiRepository } from "../domain/repositories/BotEmojiRepository";
import { BotEmojiService } from "./BotEmojiService";

interface SyncResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

/**
 * Service responsible for synchronizing emoji files with Discord and database.
 */
export class BotEmojiSyncService {
  private readonly emojiService: BotEmojiService;
  private readonly emojisDirectory = "./emojis";

  constructor(
    private readonly client: Client,
    private readonly repository: BotEmojiRepository,
    private readonly webhookService: WebhookService,
    private readonly logger: Logger,
  ) {
    this.emojiService = new BotEmojiService(client, logger);
  }

  /**
   * Performs a full emoji sync operation.
   * Only runs on shard 0 to prevent duplicate syncs.
   */
  async syncEmojis(): Promise<void> {
    // Only sync on shard 0
    if (!this.client.cluster.shardList.includes(0)) {
      this.logger.debug(
        {
          clusterId: this.client.cluster.id,
          shardList: this.client.cluster.shardList,
        },
        "Skipping emoji sync - not shard 0",
      );

      return;
    }

    this.logger.info("Starting emoji sync");
    const startTime = Date.now();

    try {
      const result = await this.performSync();
      const duration = Date.now() - startTime;

      this.logger.info(
        {
          ...result,
          durationMs: duration,
        },
        "Emoji sync completed",
      );

      // Send summary to webhook
      await this.sendSyncSummary(result, duration);
    } catch (error) {
      this.logger.error({ err: error }, "Emoji sync failed");

      await this.webhookService.logInfo(
        "🚨 Emoji Sync Failed",
        `Failed to sync emojis: ${error instanceof Error ? error.message : "Unknown error"}`,
        0xff0000, // Red
      );
    }
  }

  private async performSync(): Promise<SyncResult> {
    const result: SyncResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      errorMessages: [],
    };

    // Get all emoji files
    const emojiFiles = await this.getEmojiFiles();
    if (emojiFiles.length === 0) {
      this.logger.info("No emoji files found");
      return result;
    }

    // Get current state from Discord and database
    const [discordEmojis, dbEmojis] = await Promise.all([
      this.emojiService.getAllDiscordEmojis(),
      this.repository.getAllEmojis(),
    ]);

    const dbEmojiMap = new Map(dbEmojis.map((e) => [e.name, e]));

    // Process each emoji file
    for (const file of emojiFiles) {
      try {
        result.processed++;
        await this.syncSingleEmoji(file, discordEmojis, dbEmojiMap, result);
      } catch (error) {
        result.errors++;
        const errorMsg = `Failed to sync ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`;
        result.errorMessages.push(errorMsg);

        this.logger.error(
          { err: error, fileName: file.name },
          "Failed to sync emoji file",
        );
      }
    }

    return result;
  }

  private async syncSingleEmoji(
    file: { name: BotEmojiNameType; path: string; hash: string },
    discordEmojis: Map<string, string>,
    dbEmojiMap: Map<BotEmojiNameType, BotEmoji>,
    result: SyncResult,
  ): Promise<void> {
    const { name, path, hash } = file;

    const discordId = discordEmojis.get(name);
    const dbEmoji = dbEmojiMap.get(name);

    if (discordId && dbEmoji) {
      // Both exist - check if hash matches
      if (dbEmoji.sha256 === hash) {
        // Up to date - skip
        result.skipped++;
        this.logger.debug({ name }, "Emoji up to date");
      } else {
        // Hash differs - replace emoji
        const newId = await this.emojiService.replaceEmoji(
          name,
          discordId,
          path,
        );
        const updatedEmoji = dbEmoji.withNewId(newId, hash);
        await this.repository.updateEmoji(updatedEmoji);
        result.updated++;
        this.logger.info({ name, oldId: discordId, newId }, "Updated emoji");
      }
    } else if (discordId && !dbEmoji) {
      // Discord exists, DB missing - save to database (assume Discord is correct)
      const newEmoji = new BotEmoji(name, discordId, hash);
      await this.repository.saveEmoji(newEmoji);
      result.created++;
      this.logger.info(
        { name, id: discordId },
        "Saved existing Discord emoji to database",
      );
    } else if (!discordId && dbEmoji) {
      // DB exists, Discord missing - upload to Discord
      const newId = await this.emojiService.createEmoji(name, path);
      const updatedEmoji = dbEmoji.withNewId(newId, hash);
      await this.repository.updateEmoji(updatedEmoji);
      result.updated++;
      this.logger.info({ name, id: newId }, "Uploaded emoji to Discord");
    } else {
      // Neither exists - create new
      const newId = await this.emojiService.createEmoji(name, path);
      const newEmoji = new BotEmoji(name, newId, hash);
      await this.repository.saveEmoji(newEmoji);
      result.created++;
      this.logger.info({ name, id: newId }, "Created new emoji");
    }
  }

  private async getEmojiFiles(): Promise<
    { name: BotEmojiNameType; path: string; hash: string }[]
  > {
    try {
      const files = await readdir(this.emojisDirectory);
      const pngFiles = files.filter((f) => f.endsWith(".png"));

      const validEmojis: {
        name: BotEmojiNameType;
        path: string;
        hash: string;
      }[] = [];

      for (const filename of pngFiles) {
        const filePath = join(this.emojisDirectory, filename);
        const name = filename.replace(/\.png$/, "") as BotEmojiNameType;

        // Validate filename format
        if (!this.emojiService.validateEmojiName(filename)) {
          this.logger.error(
            { filename },
            "Invalid emoji filename - must be lowercase with underscores only",
          );
          continue;
        }

        // Check if name exists in enum
        if (!BotEmojiName.safeParse(name).success) {
          this.logger.error(
            { filename, name },
            "Emoji filename not found in BotEmojiName enum - add it to the enum first",
          );
          continue;
        }

        // Check file size
        const stats = await stat(filePath);
        if (stats.size > 256 * 1024) {
          this.logger.error(
            { filename, size: stats.size },
            "Emoji file too large - max 256KB",
          );
          continue;
        }

        // Calculate hash
        const buffer = await readFile(filePath);
        const hash = createHash("sha256").update(buffer).digest("hex");

        validEmojis.push({ name, path: filePath, hash });
      }

      this.logger.info(
        { total: pngFiles.length, valid: validEmojis.length },
        "Processed emoji files",
      );

      return validEmojis;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.logger.info("Emojis directory not found - skipping sync");
        return [];
      }
      throw error;
    }
  }

  private async sendSyncSummary(
    result: SyncResult,
    duration: number,
  ): Promise<void> {
    try {
      // Only send webhook notification if there are errors or significant changes
      const hasErrors = result.errors > 0;
      const hasSignificantChanges = result.created > 0 || result.updated > 0;

      if (!hasErrors && !hasSignificantChanges) {
        // All emojis were up to date - no need to spam webhook
        this.logger.debug(
          "Skipping webhook notification - no errors or changes",
        );
        return;
      }

      const color = hasErrors ? 0xffa500 : 0x00ff00; // Orange if errors, green otherwise
      const title = hasErrors
        ? "🔧 Emoji Sync Completed (with errors)"
        : "🔄 Emoji Sync Completed (with changes)";

      let description = `**Summary:**
• Processed: ${result.processed} files
• Created: ${result.created} emojis
• Updated: ${result.updated} emojis  
• Skipped: ${result.skipped} emojis
• Errors: ${result.errors} files
• Duration: ${duration}ms`;

      if (result.errorMessages.length > 0) {
        description += `\n\n**Errors:**\n${result.errorMessages
          .slice(0, 5)
          .map((msg) => `• ${msg}`)
          .join("\n")}`;

        if (result.errorMessages.length > 5) {
          description += `\n• ...and ${result.errorMessages.length - 5} more`;
        }
      }

      await this.webhookService.logInfo(title, description, color);
    } catch (error) {
      this.logger.error(
        { err: error },
        "Failed to send sync summary to webhook",
      );
    }
  }
}
