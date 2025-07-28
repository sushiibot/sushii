import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import { ModerationCaseRepository } from "../../shared/domain/repositories/ModerationCaseRepository";
import { CaseRange } from "../../shared/domain/value-objects/CaseRange";

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
    private readonly moderationCaseRepository: ModerationCaseRepository,
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
      const result =
        await this.moderationCaseRepository.getNextCaseNumber(guildId);
      if (result.err) {
        throw new Error(result.val);
      }
      return Number(result.val);
    };

    // Resolve the case range to actual case IDs
    const resolvedRangeResult =
      await caseRange.resolveToRange(getCurrentCaseNumber);
    if (resolvedRangeResult.err) {
      return resolvedRangeResult;
    }

    const [startCaseId, endCaseId] = resolvedRangeResult.val;

    // Fetch all cases in the range
    const casesResult = await this.moderationCaseRepository.findByRange(
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

    // Update cases in database
    const updateResult = await this.moderationCaseRepository.updateReasonBulk(
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
      const error = await this.updateModLogMessage(
        modCase,
        modLogChannel,
        executorId,
        reason,
      );

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
    executorId: string,
    newReason: string,
  ): Promise<ReasonUpdateError | null> {
    // Validate user exists
    try {
      await this.client.users.fetch(modCase.userId);
    } catch {
      return {
        caseId: modCase.caseId,
        errorType: "user_fetch",
        message: "Could not fetch user",
      };
    }

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

      if (!message.embeds[0]) {
        return {
          caseId: modCase.caseId,
          errorType: "msg_fetch",
          message: "Message has no embeds",
        };
      }

      const executor = await this.client.users.fetch(executorId);
      const oldEmbed = message.embeds[0];
      const reasonFieldIndex =
        oldEmbed.fields?.findIndex((f) => f.name === "Reason") ?? -1;

      if (reasonFieldIndex === -1) {
        return {
          caseId: modCase.caseId,
          errorType: "msg_fetch",
          message: "Reason field not found in embed",
        };
      }

      const newEmbed = new EmbedBuilder(oldEmbed.data)
        .setAuthor({
          name: executor.tag,
          iconURL: executor.displayAvatarURL(),
        })
        .spliceFields(reasonFieldIndex, 1, {
          name: "Reason",
          value: newReason,
          inline: false,
        });

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
