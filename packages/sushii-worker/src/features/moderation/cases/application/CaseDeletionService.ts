import { Client } from "discord.js";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import * as schema from "@/infrastructure/database/schema";
import { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import { ModerationCaseRepository } from "../../shared/domain/repositories/ModerationCaseRepository";
import { CaseRange } from "../../shared/domain/value-objects/CaseRange";

export interface CaseDeletionResult {
  deletedCases: ModerationCase[];
  deletedMessageIds: string[];
  affectedCount: number;
}

export class CaseDeletionService {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly moderationCaseRepository: ModerationCaseRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async deleteCaseRange(
    guildId: string,
    caseRangeStr: string,
    keepLogMessages: boolean = false,
  ): Promise<Result<CaseDeletionResult, string>> {
    this.logger.debug(
      { guildId, caseRangeStr, keepLogMessages },
      "Starting case range deletion",
    );

    // Parse the case range
    const caseRangeResult = CaseRange.fromString(caseRangeStr);
    if (caseRangeResult.err) {
      return caseRangeResult;
    }

    const caseRange = caseRangeResult.val;

    // Validate the affected count
    const affectedCount = caseRange.getAffectedCount();
    if (!affectedCount) {
      return Err("Please specify the end case ID");
    }

    if (affectedCount > 25) {
      return Err(
        "You can only delete up to 25 cases at a time. Please try again with a smaller range",
      );
    }

    // Get guild config to check mod log settings
    let modLogChannelId: string;
    try {
      const guildConfig =
        await this.guildConfigRepository.findByGuildId(guildId);
      if (
        !guildConfig?.loggingSettings.modLogChannel ||
        !guildConfig.loggingSettings.modLogEnabled
      ) {
        return Err("Mod log is not configured or disabled");
      }

      modLogChannelId = guildConfig.loggingSettings.modLogChannel;
    } catch (error) {
      return Err(`Failed to get guild config: ${error}`);
    }

    // Resolve the case range to actual case IDs
    const getCurrentCaseNumber = async () => {
      const result =
        await this.moderationCaseRepository.getNextCaseNumber(guildId);
      if (result.err) {
        throw new Error(result.val);
      }
      return Number(result.val);
    };

    const resolvedRangeResult =
      await caseRange.resolveToRange(getCurrentCaseNumber);
    if (resolvedRangeResult.err) {
      return resolvedRangeResult;
    }

    const [startCaseId, endCaseId] = resolvedRangeResult.val;

    // Validate that cases exist in the range
    if (caseRange.data.type === "single") {
      const existsResult = await this.moderationCaseRepository.exists(
        guildId,
        startCaseId.toString(),
      );
      if (existsResult.err) {
        return existsResult;
      }
      if (!existsResult.val) {
        return Err(`Case #${startCaseId} does not exist`);
      }
    }

    // Perform the deletion in a transaction
    return await this.db.transaction(async (tx) => {
      // Delete the cases
      const deletionResult = await this.moderationCaseRepository.deleteRange(
        guildId,
        startCaseId,
        endCaseId,
        tx,
      );

      if (deletionResult.err) {
        return deletionResult;
      }

      const deletedCases = deletionResult.val;

      if (deletedCases.length === 0) {
        return Err("No cases were found in the specified range");
      }

      this.logger.info(
        {
          guildId,
          startCaseId,
          endCaseId,
          deletedCount: deletedCases.length,
        },
        "Successfully deleted case range",
      );

      // Collect message IDs for deletion if not keeping log messages
      const messageIds = deletedCases
        .map((case_) => case_.msgId)
        .filter((msgId): msgId is string => msgId !== null);

      let deletedMessageIds: string[] = [];

      if (!keepLogMessages && messageIds.length > 0) {
        deletedMessageIds = await this.deleteModLogMessages(
          modLogChannelId,
          messageIds,
        );
      }

      return Ok({
        deletedCases,
        deletedMessageIds,
        affectedCount: deletedCases.length,
      });
    });
  }

  private async deleteModLogMessages(
    modLogChannelId: string,
    messageIds: string[],
  ): Promise<string[]> {
    try {
      const modLogChannel = await this.client.channels.fetch(modLogChannelId);

      if (!modLogChannel || !modLogChannel.isTextBased()) {
        this.logger.warn(
          { modLogChannelId },
          "Mod log channel not found or is not text-based",
        );
        return [];
      }

      if (!("bulkDelete" in modLogChannel)) {
        this.logger.warn(
          { modLogChannelId },
          "Mod log channel does not support bulk delete",
        );
        return [];
      }

      // Discord bulk delete only works for messages newer than 14 days
      // and has a limit of 100 messages at a time
      const chunkedMessageIds = this.chunkArray(messageIds, 100);
      const deletedIds: string[] = [];

      for (const chunk of chunkedMessageIds) {
        try {
          await modLogChannel.bulkDelete(chunk);
          deletedIds.push(...chunk);

          this.logger.debug(
            { modLogChannelId, deletedCount: chunk.length },
            "Deleted mod log messages",
          );
        } catch (error) {
          this.logger.warn(
            { error, modLogChannelId, messageCount: chunk.length },
            "Failed to delete some mod log messages (they may be older than 14 days)",
          );

          // Try individual deletion for failed bulk operations
          for (const messageId of chunk) {
            try {
              await modLogChannel.messages.delete(messageId);
              deletedIds.push(messageId);
            } catch (individualError) {
              this.logger.debug(
                { error: individualError, messageId },
                "Failed to delete individual mod log message",
              );
            }
          }
        }
      }

      return deletedIds;
    } catch (error) {
      this.logger.error(
        { error, modLogChannelId },
        "Failed to access mod log channel for message deletion",
      );
      return [];
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
