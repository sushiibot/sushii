import type { APIContainerComponent, APIMessage } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextDisplayBuilder,
  type Client,
  type Guild,
} from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import { rebuildModerationActionRow } from "../utils/alertComponentUtils";
import type { SpamAlertCache } from "./SpamAlertCache";

type ButtonActionType = "warn" | "kick" | "ban" | "softban" | "unban";

const ACTION_VERBS: Partial<Record<ActionType, string>> = {
  [ActionType.Warn]: "warned",
  [ActionType.Kick]: "kicked",
  [ActionType.Ban]: "banned",
  [ActionType.TempBan]: "banned",
  [ActionType.Softban]: "softbanned",
  [ActionType.BanRemove]: "unbanned",
  [ActionType.Timeout]: "timed out",
  [ActionType.TimeoutAdjust]: "adjusted timeout for",
  [ActionType.TimeoutRemove]: "removed timeout for",
};

// Maps audit log action types to the button context for escalation options.
// Timeout actions have no corresponding button type — only an action line is added.
const BUTTON_ACTION_TYPE: Partial<Record<ActionType, ButtonActionType>> = {
  [ActionType.Warn]: "warn",
  [ActionType.Kick]: "kick",
  [ActionType.Ban]: "ban",
  [ActionType.TempBan]: "ban",
  [ActionType.Softban]: "softban",
  [ActionType.BanRemove]: "unban",
};

function buildContextualActionRow(
  actionType: ButtonActionType,
  userId: string,
): ActionRowBuilder<ButtonBuilder> | null {
  const makeButton = (type: ButtonActionType, label: string): ButtonBuilder =>
    new ButtonBuilder()
      .setCustomId(customIds.automodAlertAction.compile({ actionType: type, userId }))
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary);

  switch (actionType) {
    case "warn":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("warn", "Warn"),
        makeButton("kick", "Kick"),
        makeButton("softban", "Softban"),
        makeButton("ban", "Ban"),
      );
    case "kick":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("softban", "Softban"),
        makeButton("ban", "Ban"),
      );
    case "softban":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("ban", "Ban"),
      );
    case "ban":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("unban", "Unban"),
      );
    case "unban":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("warn", "Warn"),
        makeButton("kick", "Kick"),
        makeButton("softban", "Softban"),
        makeButton("ban", "Ban"),
      );
  }
}

/**
 * Updates the spam detection alert message when a mod takes action on the flagged
 * user outside of the alert buttons (e.g. via a slash command or Discord UI).
 * Called fire-and-forget from AuditLogService alongside AutomodAlertReactionService.
 */
export class SpamAlertUpdateService {
  constructor(
    private readonly client: Client,
    private readonly cache: SpamAlertCache,
    private readonly logger: Logger,
  ) {}

  async updateSpamAlert(
    guild: Guild,
    targetUserId: string,
    actionType: ActionType,
    executorId: string | undefined,
  ): Promise<void> {
    // Skip self-actions (e.g. the bot's own auto-timeout from spam detection)
    if (!executorId || executorId === this.client.user?.id) {
      return;
    }

    const verb = ACTION_VERBS[actionType];
    if (!verb) {
      return;
    }

    const entry = this.cache.consume(guild.id, targetUserId);
    if (!entry) {
      this.logger.debug(
        { guildId: guild.id, targetUserId, actionType },
        "No spam alert in cache for user, skipping update",
      );
      return;
    }

    try {
      const channel = guild.channels.cache.get(entry.channelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        return;
      }

      const message = await channel.messages.fetch(entry.messageId);
      const rawMessage = message.toJSON() as APIMessage;
      const rawContainer = (rawMessage.components ?? [])[0] as
        | APIContainerComponent
        | undefined;
      if (!rawContainer) {
        return;
      }

      const actionLine = `-# <@${executorId}> ${verb} <@${targetUserId}>`;
      const buttonActionType = BUTTON_ACTION_TYPE[actionType] ?? null;

      const newActionRow = buttonActionType
        ? buildContextualActionRow(buttonActionType, targetUserId)
        : null;

      const updatedContainer = rebuildModerationActionRow(
        rawContainer,
        new TextDisplayBuilder().setContent(actionLine).toJSON(),
        newActionRow ? newActionRow.toJSON() : null,
      );

      await message.edit({
        components: [updatedContainer],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });

      this.logger.info(
        {
          guildId: guild.id,
          targetUserId,
          actionType,
          executorId,
          messageId: entry.messageId,
        },
        "Updated spam alert with mod action",
      );
    } catch (err) {
      this.logger.warn(
        { err, guildId: guild.id, targetUserId, messageId: entry.messageId },
        "Failed to update spam alert",
      );
    }
  }
}
