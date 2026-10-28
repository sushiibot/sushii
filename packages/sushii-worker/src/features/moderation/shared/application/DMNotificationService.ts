import type { Client, Guild, MessageEditOptions, User } from "discord.js";
import {
  DiscordAPIError,
  EmbedBuilder,
  RESTJSONErrorCodes,
  TimestampStyles,
} from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import dayjs from "@/shared/domain/dayjs";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import Color from "@/utils/colors";
import toTimestamp from "@/utils/toTimestamp";

import type {
  DMFailureReason,
  ModerationCase,
} from "../domain/entities/ModerationCase";
import {
  ActionType,
  actionTypeSupportsDM,
} from "../domain/value-objects/ActionType";
import type { Reason } from "../domain/value-objects/Reason";

type DmTextSetting =
  | "warnDmText"
  | "timeoutDmText"
  | "banDmText"
  | "kickDmText";

/** The `/settings` field holding the extra DM text for an action, or null when it has none. */
export function guildDmTextSetting(action: ActionType): DmTextSetting | null {
  switch (action) {
    case ActionType.Warn:
      return "warnDmText";
    // An adjusted timeout's DM is a timeout DM.
    case ActionType.Timeout:
    case ActionType.TimeoutAdjust:
      return "timeoutDmText";
    case ActionType.Ban:
    case ActionType.TempBan:
    case ActionType.Softban:
      return "banDmText";
    case ActionType.Kick:
      return "kickDmText";
    default:
      return null;
  }
}

/** The extra DM text from `/settings` that a DM for this action carries. */
export function guildDmText(
  action: ActionType,
  guildConfig: GuildConfig,
): string | null {
  const setting = guildDmTextSetting(action);
  return setting ? guildConfig.moderationSettings[setting] : null;
}

/**
 * Application service for building and sending DM notifications for moderation actions.
 * Handles the business logic for when and how to send moderation DMs.
 */
export class DMNotificationService {
  constructor(private readonly logger: Logger) {}

  /**
   * Builds a DM embed for moderation actions.
   */
  buildDMEmbed(
    guild: Guild,
    action: ActionType,
    shouldDMReason: boolean,
    reason: Reason | null,
    durationEnd: dayjs.Dayjs | null,
    customText?: string | null,
  ): EmbedBuilder {
    const fields = [];

    // Timeout or tempban
    if (durationEnd) {
      const actionName = this.getActionDisplayName(action);
      fields.push({
        name: "Duration",
        value: `Your ${actionName} will expire ${toTimestamp(
          durationEnd,
          TimestampStyles.RelativeTime,
        )}`,
      });
    }

    // Add custom message as an additional field if provided
    if (customText) {
      fields.push({
        name: "Additional Information",
        value: customText,
      });
    }

    // Always use the informational title
    const title = this.getDMTitle(action);

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setAuthor({
        name: guild.name,
        iconURL: guild.iconURL() || undefined,
      })
      .setFields(fields)
      .setColor(Color.Warning);

    if (shouldDMReason && reason) {
      embed.setDescription(`**Reason**\n${reason.value}`);
    }

    return embed;
  }

  /**
   * Sends a moderation DM to the target user.
   */
  async sendModerationDM(
    targetUser: User,
    guild: Guild,
    action: ActionType,
    shouldDMReason: boolean,
    reason: Reason | null,
    durationEnd: dayjs.Dayjs | null,
    guildConfig?: GuildConfig,
    customText?: string | null,
  ): Promise<Result<DMSentResult, string>> {
    // Check if this action type supports DMs
    if (!actionTypeSupportsDM(action)) {
      return Err(`Action type ${action} does not support DM notifications`);
    }

    try {
      // Get custom text from guild config if not provided directly
      let dmText = customText;
      if (!dmText && guildConfig) {
        dmText = this.getGuildCustomDMText(action, guildConfig);
      }

      const embed = this.buildDMEmbed(
        guild,
        action,
        shouldDMReason,
        reason,
        durationEnd,
        dmText,
      );

      this.logger.info(
        {
          actionType: action,
          targetUserId: targetUser.id,
          guildId: guild.id,
          hasCustomText: !!dmText,
          shouldDMReason,
        },
        "Sending moderation DM to user",
      );

      const dmMessage = await targetUser.send({
        embeds: [embed],
      });

      this.logger.debug(
        {
          targetUserId: targetUser.id,
          guildId: guild.id,
          dmChannelId: dmMessage.channel.id,
          dmMessageId: dmMessage.id,
        },
        "Successfully sent moderation DM",
      );

      return Ok({
        channelId: dmMessage.channel.id,
        messageId: dmMessage.id,
        error: null,
        failureReason: null,
      });
    } catch (error) {
      this.logger.debug(
        {
          err: error,
          actionType: action,
          targetUserId: targetUser.id,
          guildId: guild.id,
        },
        "Failed to send moderation DM to user",
      );

      if (error instanceof DiscordAPIError) {
        if (error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser) {
          return Ok({
            channelId: null,
            messageId: null,
            error: "User has blocked the bot",
            failureReason: "user_blocked",
          });
        }

        if (
          error.code ===
          RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds
        ) {
          return Ok({
            channelId: null,
            messageId: null,
            error: "User has server DMs disabled or no mutual guilds",
            failureReason: "user_privacy",
          });
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Ok({
        channelId: null,
        messageId: null,
        error: errorMessage,
        failureReason: null,
      });
    }
  }

  /**
   * Rebuilds the DM a case sent, with the case's current reason. Matches
   * sendModerationDM; the guild's DM text is read again from its config.
   */
  buildCaseDMEmbed(
    guild: Guild,
    moderationCase: ModerationCase,
    guildConfig: GuildConfig,
  ): EmbedBuilder {
    const seconds = moderationCase.timeoutDuration;
    const isTemporal =
      moderationCase.actionType === ActionType.Timeout ||
      moderationCase.actionType === ActionType.TimeoutAdjust ||
      moderationCase.actionType === ActionType.TempBan;
    const durationEnd =
      isTemporal && seconds != null && seconds > 0
        ? dayjs(moderationCase.actionTime).add(seconds, "seconds")
        : null;

    // The original DM for an adjusted timeout was sent as a timeout.
    const action =
      moderationCase.actionType === ActionType.TimeoutAdjust
        ? ActionType.Timeout
        : moderationCase.actionType;

    return this.buildDMEmbed(
      guild,
      action,
      true,
      moderationCase.reason,
      durationEnd,
      this.getGuildCustomDMText(action, guildConfig),
    );
  }

  /**
   * Edits a DM the bot sent. The user may have deleted it, blocked the bot or
   * left every mutual server, so failures are expected and logged, not thrown.
   */
  async editModerationDM(
    client: Client,
    channelId: string,
    messageId: string,
    payload: MessageEditOptions,
  ): Promise<DMEditOutcome> {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isDMBased() || !channel.isTextBased()) {
        this.logger.warn(
          { channelId, messageId },
          "Moderation DM channel is missing or not a DM",
        );
        return "failed";
      }

      await channel.messages.edit(messageId, payload);
      return "updated";
    } catch (err) {
      this.logger.warn(
        { err, channelId, messageId },
        "Failed to edit moderation DM",
      );
      return "failed";
    }
  }

  /** Edits the case's DM to show its current reason. */
  async editCaseDM(
    client: Client,
    moderationCase: ModerationCase,
    guildConfig: GuildConfig,
  ): Promise<DMEditOutcome> {
    const channelId = moderationCase.dmResult?.channelId;
    const messageId = moderationCase.dmResult?.messageId;
    if (moderationCase.dmDeleted || !channelId || !messageId) {
      return "no_dm";
    }

    const guild = client.guilds.cache.get(moderationCase.guildId);
    if (!guild) {
      this.logger.warn(
        { guildId: moderationCase.guildId, caseId: moderationCase.caseId },
        "Guild not cached, can't rebuild the moderation DM",
      );
      return "failed";
    }

    return this.editModerationDM(client, channelId, messageId, {
      embeds: [this.buildCaseDMEmbed(guild, moderationCase, guildConfig)],
    });
  }

  async deleteModerationDM(
    client: Client,
    dmChannelId: string,
    messageId: string,
  ): Promise<void> {
    const channel = await client.channels.fetch(dmChannelId);
    if (!channel) {
      // Could not find
      return;
    }

    if (!channel.isDMBased()) {
      throw new Error("Channel is not a DM channel");
    }

    await channel.messages.delete(messageId);
  }

  /**
   * Gets the DM title that is always sent for an action type.
   * This provides clear information about what action was taken.
   */
  private getDMTitle(action: ActionType): string {
    switch (action) {
      case ActionType.Timeout:
        return "You have been timed out";
      case ActionType.Warn:
        return "You have received a warning";
      case ActionType.Ban:
        return "You have been banned";
      case ActionType.Softban:
        return "You have been softbanned";
      case ActionType.TimeoutRemove:
        return "Your timeout has been removed";
      case ActionType.TempBan:
        return "You have been temporarily banned";
      case ActionType.Kick:
        return "You have been kicked";
      default:
        return `Moderation action taken: ${this.getActionDisplayName(action)}`;
    }
  }

  /**
   * Gets the display name for an action type.
   */
  private getActionDisplayName(action: ActionType): string {
    switch (action) {
      case ActionType.Ban:
        return "banned";
      case ActionType.Softban:
        return "softbanned";
      case ActionType.TempBan:
        return "temporarily banned";
      case ActionType.Kick:
        return "kicked";
      case ActionType.Timeout:
        return "timeout";
      case ActionType.TimeoutRemove:
        return "timeout removal";
      case ActionType.Warn:
        return "warned";
      default:
        return action;
    }
  }

  private getGuildCustomDMText(
    action: ActionType,
    guildConfig: GuildConfig,
  ): string | null {
    return guildDmText(action, guildConfig);
  }
}

/**
 * Result of attempting to send a DM.
 */
export interface DMSentResult {
  channelId: string | null;
  messageId: string | null;
  error: string | null;
  failureReason: DMFailureReason | null;
}

/**
 * - `updated`: the DM now shows the case's current reason
 * - `no_dm`: there's no DM to edit (never sent, failed or deleted)
 * - `failed`: Discord refused or the DM is gone; logged at warn
 */
export type DMEditOutcome = "updated" | "no_dm" | "failed";
