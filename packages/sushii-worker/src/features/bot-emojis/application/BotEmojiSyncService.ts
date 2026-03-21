import { createHash } from "crypto";
import type { Client } from "discord.js";
import { readFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";
import type { Logger } from "pino";
import { Decrypter } from "age-encryption";

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
 *
 * Reads from the assets/ directory. Files ending in .png.age are decrypted
 * using ASSET_KEY; plain .png files are used as-is. If both exist for the
 * same name, the encrypted asset takes priority.
 */
export class BotEmojiSyncService {
  private readonly emojiService: BotEmojiService;
  private readonly assetsDirectory = resolve(
    join(import.meta.dir, "../../../../assets"),
  );

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

    const allFiles = await this.loadAssets();

    if (allFiles.length === 0) {
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
    for (const file of allFiles) {
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
    file: { name: BotEmojiNameType; buffer: Buffer; hash: string },
    discordEmojis: Map<string, string>,
    dbEmojiMap: Map<BotEmojiNameType, BotEmoji>,
    result: SyncResult,
  ): Promise<void> {
    const { name, buffer, hash } = file;

    const discordId = discordEmojis.get(name);
    const dbEmoji = dbEmojiMap.get(name);

    if (discordId && dbEmoji) {
      // Both exist - check if hash matches
      if (dbEmoji.sha256 === hash) {
        // Up to date - skip
        result.skipped++;
        this.logger.debug({ emojiName: name }, "Emoji up to date");
      } else {
        // Hash differs - replace emoji
        const newId = await this.emojiService.replaceEmoji(
          name,
          discordId,
          buffer,
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
      const newId = await this.emojiService.createEmoji(name, buffer);
      const updatedEmoji = dbEmoji.withNewId(newId, hash);
      await this.repository.updateEmoji(updatedEmoji);
      result.updated++;
      this.logger.info({ name, id: newId }, "Uploaded emoji to Discord");
    } else {
      // Neither exists - create new
      const newId = await this.emojiService.createEmoji(name, buffer);
      const newEmoji = new BotEmoji(name, newId, hash);
      await this.repository.saveEmoji(newEmoji);
      result.created++;
      this.logger.info({ name, id: newId }, "Created new emoji");
    }
  }

  /**
   * Loads all assets from the assets/ directory.
   * Supports plain .png and encrypted .png.age files.
   * If both exist for the same name, the encrypted asset takes priority.
   */
  private async loadAssets(): Promise<
    { name: BotEmojiNameType; buffer: Buffer; hash: string }[]
  > {
    const assetKey = process.env.ASSET_KEY;

    try {
      const files = await readdir(this.assetsDirectory);

      // Group by emoji name, tracking plain and encrypted variants
      const byName = new Map<string, { plain?: string; encrypted?: string }>();

      for (const filename of files) {
        if (filename.endsWith(".png.age")) {
          const name = filename.replace(/\.png\.age$/, "");
          const entry = byName.get(name) ?? {};
          entry.encrypted = filename;
          byName.set(name, entry);
        } else if (filename.endsWith(".png")) {
          const name = filename.replace(/\.png$/, "");
          const entry = byName.get(name) ?? {};
          entry.plain = filename;
          byName.set(name, entry);
        }
      }

      const hasEncrypted = [...byName.values()].some((v) => v.encrypted);
      if (hasEncrypted && !assetKey) {
        this.logger.warn(
          "ASSET_KEY not set - encrypted assets will be skipped, falling back to plain files",
        );
      }

      const assets: { name: BotEmojiNameType; buffer: Buffer; hash: string }[] =
        [];

      for (const [nameStr, { plain, encrypted }] of byName) {
        const parsed = BotEmojiName.safeParse(nameStr);
        if (!parsed.success) {
          this.logger.error(
            { name: nameStr },
            "Asset name not found in BotEmojiName enum - add it to the enum first",
          );
          continue;
        }
        const name = parsed.data;

        if (encrypted && assetKey) {
          // Prefer encrypted asset
          const filePath = join(this.assetsDirectory, encrypted);
          const ciphertext = await readFile(filePath);
          const decrypter = new Decrypter();
          decrypter.addPassphrase(assetKey);
          const plaintext = await decrypter.decrypt(
            new Uint8Array(ciphertext),
            "uint8array",
          );
          const buffer = Buffer.from(plaintext);
          const hash = createHash("sha256")
            .update(plaintext)
            .digest("hex");
          assets.push({ name, buffer, hash });
        } else if (plain) {
          // Fall back to plain PNG
          const filePath = join(this.assetsDirectory, plain);
          const fileStats = await stat(filePath);
          if (fileStats.size > 256 * 1024) {
            this.logger.error(
              { filename: plain, size: fileStats.size },
              "Emoji file too large - max 256KB",
            );
            continue;
          }
          const buffer = await readFile(filePath);
          const hash = createHash("sha256")
            .update(new Uint8Array(buffer))
            .digest("hex");
          assets.push({ name, buffer, hash });
        }
        // if only encrypted but no key: skip silently (warning already logged above)
      }

      this.logger.info({ count: assets.length }, "Loaded assets");
      return assets;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.logger.info("assets directory not found - skipping sync");
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
