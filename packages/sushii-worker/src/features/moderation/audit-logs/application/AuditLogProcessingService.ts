import type { Guild, GuildAuditLogsEntry, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { ModLogComponentBuilder } from "@/features/moderation/shared/domain/services/ModLogComponentBuilder";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ActionType } from "../../shared";
import { AuditLogEvent } from "../domain/entities";

/**
 * Application service for processing Discord audit log events.
 * Orchestrates the creation and updating of mod log cases.
 */
export class AuditLogProcessingService {
  constructor(
    private readonly modLogRepository: ModLogRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Processes a Discord audit log entry and creates/updates mod log cases.
   */
  async processAuditLogEntry(
    entry: GuildAuditLogsEntry,
    guild: Guild,
  ): Promise<Result<ProcessedAuditLog | null, string>> {
    try {
      // Convert Discord entry to domain entity
      const auditLogEvent = AuditLogEvent.fromDiscordEntry(guild.id, entry);
      if (!auditLogEvent) {
        // Unrelated audit log entry
        return Ok(null);
      }

      this.logger.debug(
        {
          guildId: guild.id,
          actionType: auditLogEvent.actionType,
          targetId: auditLogEvent.targetId,
          executorId: auditLogEvent.executorId,
        },
        "Processing moderation audit log event",
      );

      // Check guild configuration
      const guildConfig = await this.guildConfigRepository.findByGuildId(
        guild.id,
      );
      if (
        !guildConfig.loggingSettings.modLogChannel ||
        !guildConfig.loggingSettings.modLogEnabled
      ) {
        this.logger.debug(
          {
            guildId: guild.id,
            modLogChannelId: guildConfig.loggingSettings.modLogChannel,
            modLogEnabled: guildConfig.loggingSettings.modLogEnabled,
          },
          "Mod log not configured or disabled",
        );

        // Cannot continue
        return Ok(null);
      }

      // Validate target
      if (!entry.targetId || entry.targetType !== "User") {
        this.logger.debug(
          { guildId: guild.id, targetType: entry.targetType },
          "Audit log target is not a user",
        );

        return Ok(null);
      }

      // Fetch target user
      const targetUser = await guild.client.users.fetch(entry.targetId);

      // Find or create mod log case
      const { modLogCase, wasPendingCase } = await this.findOrCreateModLogCase(
        auditLogEvent,
        targetUser,
      );

      return Ok({
        auditLogEvent,
        modLogCase,
        targetUser,
        guildConfig: {
          modLogChannelId: guildConfig.loggingSettings.modLogChannel,
        },
        wasPendingCase,
      });
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: guild.id,
          entryAction: entry.action,
        },
        "Failed to process audit log entry",
      );
      return Err(`Failed to process audit log entry: ${error}`);
    }
  }

  /**
   * Finds an existing pending mod log case or creates a new one.
   * Returns the moderation case and whether it was a pending case.
   */
  private async findOrCreateModLogCase(
    auditLogEvent: AuditLogEvent,
    targetUser: User,
  ): Promise<{ modLogCase: ModerationCase; wasPendingCase: boolean }> {
    const actionTypesToSearch =
      auditLogEvent.actionType === ActionType.Ban
        ? // Ban audit log can be triggered by either ban or tempban actions
          [ActionType.Ban, ActionType.TempBan]
        : [auditLogEvent.actionType];

    let foundPendingCase;
    for (const actionType of actionTypesToSearch) {
      // Look for pending case created in the last minute
      const pendingCase = await this.modLogRepository.findPendingCase(
        auditLogEvent.guildId,
        auditLogEvent.targetId,
        actionType,
        1, // maxAgeMinutes
      );

      if (pendingCase.err) {
        // Not if null, only if actual error
        throw new Error("Error finding pending case", {
          cause: pendingCase.val,
        });
      }

      // Not null, found result
      if (pendingCase.val) {
        foundPendingCase = pendingCase.val;
      }
    }

    if (foundPendingCase) {
      this.logger.debug(
        { caseId: foundPendingCase.caseId },
        "Found pending case, marking as not pending",
      );

      // Mark the case as not pending
      const markResult = await this.modLogRepository.markAsNotPending(
        auditLogEvent.guildId,
        foundPendingCase.caseId,
      );
      if (markResult.err) {
        throw new Error(
          `Failed to mark case as not pending: ${markResult.val}`,
        );
      }

      return {
        modLogCase: foundPendingCase.withPending(false),
        wasPendingCase: true,
      };
    }

    // Create new case if no matching case found
    this.logger.debug("No pending case found, creating new case");

    // Extract timeout duration in seconds if available
    const timeoutDuration = auditLogEvent.timeoutChange?.asSeconds() ?? null;

    // For audit log cases, we need to generate a case ID using the existing pattern
    // Since we don't have access to ModerationCaseRepository here, we'll use the ModLogRepository
    // which handles the case ID generation internally
    const newCase = new ModerationCase(
      auditLogEvent.guildId,
      "placeholder", // Will be replaced by repository
      auditLogEvent.actionType,
      new Date(),
      auditLogEvent.targetId,
      targetUser.tag,
      auditLogEvent.executorId || null,
      auditLogEvent.reason
        ? Reason.create(auditLogEvent.reason).unwrap()
        : null,
      null, // Will be set when message is sent
      [], // No attachments for audit log cases
      null, // No DM result yet
      false, // Not pending since it's from audit log
      timeoutDuration,
    );

    const createResult = await this.modLogRepository.createCase(newCase);
    if (createResult.err) {
      throw new Error("Failed to create new mod log case", {
        cause: createResult.val,
      });
    }

    const createdCase = createResult.val;
    this.logger.debug(
      { caseId: createdCase.caseId },
      "Created new mod log case",
    );

    return {
      modLogCase: createdCase,
      wasPendingCase: false,
    };
  }

  /**
   * Updates a mod log case with message ID.
   */
  async updateModLogCaseMessageId(
    guildId: string,
    caseId: string,
    messageId: string,
  ): Promise<Result<void, string>> {
    const result = await this.modLogRepository.updateMessageId(
      guildId,
      caseId,
      messageId,
    );

    if (result.ok) {
      this.logger.debug(
        { guildId, caseId, messageId },
        "Updated mod log case with message ID",
      );
    }

    return result;
  }

  /**
   * Updates a mod log case with DM information.
   */
  async updateModLogCaseDMInfo(
    guildId: string,
    caseId: string,
    dmChannelId: string | null,
    dmMessageId: string | null,
    dmMessageError: string | null,
  ): Promise<Result<void, string>> {
    const dmResult = {
      channelId: dmChannelId || undefined,
      messageId: dmMessageId || undefined,
      error: dmMessageError || undefined,
    };

    const result = await this.modLogRepository.updateDMInfo(
      guildId,
      caseId,
      dmResult,
    );

    if (result.ok) {
      this.logger.debug(
        { guildId, caseId, dmChannelId, dmMessageId, dmMessageError },
        "Updated mod log case with DM information",
      );
    }

    return result;
  }

  /**
   * Builds mod log components for the given action and case data.
   */
  buildModLogComponents(
    auditLogEvent: AuditLogEvent,
    modLogCase: ModerationCase,
    dmDeleted: boolean = false,
  ): ModLogComponentBuilder {
    return new ModLogComponentBuilder(
      auditLogEvent.actionType,
      modLogCase,
      dmDeleted,
    );
  }
}

/**
 * Result of processing an audit log entry.
 */
export interface ProcessedAuditLog {
  auditLogEvent: AuditLogEvent;
  modLogCase: ModerationCase;
  targetUser: User;
  guildConfig: {
    modLogChannelId: string;
  };
  wasPendingCase: boolean;
}
