import type { Client, TextChannel, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import { CaseRange } from "../../shared/domain/value-objects/CaseRange";
import buildModLogEmbed from "../../shared/presentation/buildModLogEmbed";

export interface ReasonUpdateResult {
  updatedCases: ModerationCase[];
  errors: ReasonUpdateError[];
}

export interface ReasonUpdateError {
  caseId: string;
  errorType: "user_fetch" | "msg_missing" | "msg_fetch" | "permission";
  message: string;
}

export interface ReasonUpdateOptions {
  guildId: string;
  executorId: string;
  caseRangeStr: string;
  reason: string;
  onlyEmpty: boolean;
}

export class ReasonUpdateService {
  constructor(
    private readonly modLogRepository: ModLogRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async checkExistingReasons(
    guildId: string,
    caseRangeStr: string,
  ): Promise<
    Result<{ cases: ModerationCase[]; hasExistingReasons: boolean }, string>
  > {
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
      return Err("You can only modify up to 25 cases at a time");
    }

    // Get the next case number to resolve "latest" ranges
    const getCurrentCaseNumber = async () => {
      // Get the latest case to determine the current max case number
      const result = await this.modLogRepository.findRecent(guildId, 1);
      if (result.err) {
        throw new Error(result.val);
      }
      const latestCase = result.val[0];
      return latestCase ? Number(latestCase.caseId) + 1 : 1;
    };

    // Resolve the case range to actual case IDs
    const resolvedRangeResult =
      await caseRange.resolveToRange(getCurrentCaseNumber);
    if (resolvedRangeResult.err) {
      return resolvedRangeResult;
    }

    const [startCaseId, endCaseId] = resolvedRangeResult.val;

    // Fetch all cases in the range
    const casesResult = await this.modLogRepository.findByRange(
      guildId,
      startCaseId,
      endCaseId,
    );

    if (casesResult.err) {
      return Err(casesResult.val);
    }

    const cases = casesResult.val;
    const hasExistingReasons = cases.some((c) => c.reason !== null);

    return Ok({ cases, hasExistingReasons });
  }

  async updateReasons(
    options: ReasonUpdateOptions,
  ): Promise<Result<ReasonUpdateResult, string>> {
    const { guildId, executorId, caseRangeStr, reason, onlyEmpty } = options;

    this.logger.debug(
      { guildId, caseRangeStr, reason, onlyEmpty },
      "Starting reason update",
    );

    // Get guild config to check mod log settings
    const guildConfig = await this.guildConfigRepository.findByGuildId(guildId);
    if (
      !guildConfig?.loggingSettings.modLogChannel ||
      !guildConfig.loggingSettings.modLogEnabled
    ) {
      return Err("Mod log is not configured or disabled");
    }

    const modLogChannelId = guildConfig.loggingSettings.modLogChannel;

    // Parse and resolve the case range
    const caseRangeResult = CaseRange.fromString(caseRangeStr);
    if (caseRangeResult.err) {
      return caseRangeResult;
    }

    const caseRange = caseRangeResult.val;

    // Get the next case number to resolve "latest" ranges
    const getCurrentCaseNumber = async () => {
      // Get the latest case to determine the current max case number
      const result = await this.modLogRepository.findRecent(guildId, 1);
      if (result.err) {
        throw new Error(result.val);
      }
      const latestCase = result.val[0];
      return latestCase ? Number(latestCase.caseId) + 1 : 1;
    };

    const resolvedRangeResult =
      await caseRange.resolveToRange(getCurrentCaseNumber);
    if (resolvedRangeResult.err) {
      return resolvedRangeResult;
    }

    const [startCaseId, endCaseId] = resolvedRangeResult.val;

    // Update cases in database
    const updateResult = await this.modLogRepository.updateReasonBulk(
      guildId,
      executorId,
      startCaseId,
      endCaseId,
      reason,
      onlyEmpty,
    );

    if (updateResult.err) {
      return updateResult;
    }

    const updatedCases = updateResult.val;

    if (updatedCases.length === 0) {
      return Ok({
        updatedCases: [],
        errors: [],
      });
    }

    // Update mod log messages (best effort)
    const errors: ReasonUpdateError[] = [];
    const modLogChannel = await this.fetchModLogChannel(modLogChannelId);

    if (!modLogChannel) {
      this.logger.warn({ modLogChannelId }, "Could not fetch mod log channel");
      // Continue without updating messages
      return Ok({
        updatedCases,
        errors: [
          {
            caseId: "all",
            errorType: "permission" as const,
            message: `Could not access mod log channel <#${modLogChannelId}>`,
          },
        ],
      });
    }

    // Update each mod log message
    for (const modCase of updatedCases) {
      const error = await this.updateModLogMessage(modCase, modLogChannel);

      if (error) {
        errors.push(error);
      }
    }

    return Ok({
      updatedCases,
      errors,
    });
  }

  private async fetchModLogChannel(
    channelId: string,
  ): Promise<TextChannel | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !channel.isSendable()) {
        return null;
      }
      return channel as TextChannel;
    } catch (error) {
      this.logger.error(
        { error, channelId },
        "Failed to fetch mod log channel",
      );
      return null;
    }
  }

  private async updateModLogMessage(
    modCase: ModerationCase,
    modLogChannel: TextChannel,
  ): Promise<ReasonUpdateError | null> {
    // Check if message ID exists
    if (!modCase.msgId) {
      return {
        caseId: modCase.caseId,
        errorType: "msg_missing",
        message: "Mod log message ID not found",
      };
    }

    // Try to fetch and update the message
    try {
      const message = await modLogChannel.messages.fetch(modCase.msgId);

      // Fetch the target user for rebuilding the embed
      let targetUser: User;
      try {
        targetUser = await this.client.users.fetch(modCase.userId);
      } catch (error) {
        this.logger.error(
          { error, userId: modCase.userId },
          "Failed to fetch target user for mod log update",
        );
        return {
          caseId: modCase.caseId,
          errorType: "user_fetch",
          message: "Could not fetch target user",
        };
      }

      // Build new embed using the pure function with updated case data
      const newEmbed = await buildModLogEmbed(
        this.client,
        modCase.actionType,
        targetUser,
        {
          case_id: modCase.caseId,
          executor_id: modCase.executorId,
          reason: modCase.reason?.value || null,
          attachments: modCase.attachments,
        },
      );

      await message.edit({
        embeds: [newEmbed],
        components: [], // Clear any reason buttons
      });

      return null; // Success
    } catch (error) {
      this.logger.error(
        { error, caseId: modCase.caseId, msgId: modCase.msgId },
        "Failed to update mod log message",
      );

      return {
        caseId: modCase.caseId,
        errorType: "msg_fetch",
        message: "Could not fetch or update mod log message",
      };
    }
  }
}
