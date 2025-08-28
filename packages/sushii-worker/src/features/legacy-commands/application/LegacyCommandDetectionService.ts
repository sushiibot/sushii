import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { LegacyCommand } from "../domain";
import { LegacyCommand as LegacyCommandEntity } from "../domain";
import {
  LEGACY_COMMANDS,
  LEGACY_COMMAND_SUNSET_DATE,
  TAG_SUBCOMMAND_MAPPINGS,
} from "../domain";

type DbType = NodePgDatabase<typeof schema>;

export class LegacyCommandDetectionService {
  constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  async detectLegacyCommand(
    content: string,
    guildId: string,
  ): Promise<LegacyCommand | null> {
    // Skip detection if we're past the sunset date
    if (new Date() > LEGACY_COMMAND_SUNSET_DATE) {
      return null;
    }

    // Get guild prefix
    const guildConfig = await this.guildConfigRepository.findByGuildId(guildId);
    const prefix = guildConfig.prefix || "-";

    // Check if message starts with prefix
    if (!content.startsWith(prefix)) {
      return null;
    }

    const contentWithoutPrefix = content.slice(prefix.length).trim();
    const words = contentWithoutPrefix.split(/\s+/);
    const firstWord = words[0]?.toLowerCase();

    if (!firstWord) {
      return null;
    }

    // First check for known legacy commands
    const legacyCommand = await this.detectKnownCommand(firstWord, words);
    if (legacyCommand) {
      return legacyCommand;
    }

    // Then check for direct tag usage
    const tagCommand = await this.detectTagUsage(firstWord, guildId);
    if (tagCommand) {
      return tagCommand;
    }

    return null;
  }

  private async detectKnownCommand(
    firstWord: string,
    words: string[],
  ): Promise<LegacyCommand | null> {
    // Check against known legacy commands
    for (const cmd of LEGACY_COMMANDS) {
      if (firstWord === cmd.primary || cmd.aliases.includes(firstWord)) {
        // Special handling for tag commands with subcommands
        if (cmd.primary === "tag" || firstWord === "t") {
          const subcommand = words[1]?.toLowerCase() || "get";
          const replacement = TAG_SUBCOMMAND_MAPPINGS[subcommand] || "/t";

          return LegacyCommandEntity.fromData({
            name: `tag ${subcommand}`,
            replacement,
          });
        }

        return LegacyCommandEntity.fromData({
          name: cmd.primary,
          replacement: cmd.replacement,
        });
      }
    }

    return null;
  }

  private async detectTagUsage(
    potentialTag: string,
    guildId: string,
  ): Promise<LegacyCommand | null> {
    // Skip if it contains special characters that tags don't allow
    if (!/^[a-zA-Z0-9_-]+$/.test(potentialTag)) {
      return null;
    }

    // Query tags table to see if this tag exists
    const result = await this.db
      .select({ tagName: schema.tagsInAppPublic.tagName })
      .from(schema.tagsInAppPublic)
      .where(
        and(
          eq(schema.tagsInAppPublic.guildId, BigInt(guildId)),
          eq(schema.tagsInAppPublic.tagName, potentialTag),
        ),
      )
      .limit(1);

    if (result.length > 0) {
      return LegacyCommandEntity.fromData({
        name: `tag ${potentialTag}`,
        replacement: `/t ${potentialTag}`,
      });
    }

    return null;
  }
}
