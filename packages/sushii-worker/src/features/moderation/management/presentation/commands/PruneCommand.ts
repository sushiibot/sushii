import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import { PruneMessageService } from "../../application/PruneMessageService";
import {
  PruneAttachmentsOption,
  PruneBotsOrUsersOption,
} from "../../domain/value-objects/MessageFilter";
import { PruneOptions } from "../../domain/value-objects/PruneOptions";
import { pruneErrorView, pruneSuccessView } from "../views/PruneView";

enum PruneOption {
  BeforeMessageID = "before_message_id",
  AfterMessageID = "after_message_id",
  UserOption = "user",
  MaxDeleteCount = "max_delete_count",
  Attachments = "attachments",
  SkipPinned = "skip_pinned",
  BotsOrUsers = "bots_or_users",
}

export class PruneCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("prune")
    .setDescription("Bulk delete messages with optional filters.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) =>
      o
        .setName(PruneOption.MaxDeleteCount)
        .setDescription("Max messages to delete. (2-100)")
        .setMinValue(2)
        .setMaxValue(100)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName(PruneOption.AfterMessageID)
        .setDescription(
          "Delete messages **after** this message ID or message link. (exclusive)",
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName(PruneOption.BeforeMessageID)
        .setDescription(
          "Delete messages **before** this message ID or message link. (exclusive)",
        )
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName(PruneOption.UserOption)
        .setDescription("Delete messages from only this user.")
        .setRequired(false),
    )
    .addBooleanOption((o) =>
      o
        .setName(PruneOption.SkipPinned)
        .setDescription("Don't delete pinned messages.")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName(PruneOption.BotsOrUsers)
        .setDescription("Filter by messages by bots or users.")
        .setChoices(
          {
            name: "Only delete messages by USERS",
            value: PruneBotsOrUsersOption.UsersOnly,
          },
          {
            name: "Only delete messages by BOTS",
            value: PruneBotsOrUsersOption.BotsOnly,
          },
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName(PruneOption.Attachments)
        .setDescription("Filter by messages with or without attachments.")
        .setChoices(
          {
            name: "Only delete messages WITH attachments",
            value: PruneAttachmentsOption.WithAttachments,
          },
          {
            name: "Only delete messages WITHOUT attachments",
            value: PruneAttachmentsOption.WithoutAttachments,
          },
        )
        .setRequired(false),
    )
    .toJSON();

  constructor(
    private readonly pruneMessageService: PruneMessageService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    if (!interaction.channel?.isTextBased()) {
      throw new Error("Channel is not text based");
    }

    // Extract options from interaction
    const maxDeleteCount = interaction.options.getInteger(
      PruneOption.MaxDeleteCount,
    );
    const afterMessageIDStr = interaction.options.getString(
      PruneOption.AfterMessageID,
    );
    const beforeMessageIDStr = interaction.options.getString(
      PruneOption.BeforeMessageID,
    );
    const user = interaction.options.getUser(PruneOption.UserOption);
    const skipPinned = interaction.options.getBoolean(PruneOption.SkipPinned);
    const attachments = interaction.options.getString(PruneOption.Attachments);
    const botsOrUsers = interaction.options.getString(PruneOption.BotsOrUsers);

    if (!maxDeleteCount) {
      throw new Error("Missing max delete count");
    }

    // Create and validate prune options
    const optionsResult = PruneOptions.create(
      maxDeleteCount,
      afterMessageIDStr,
      beforeMessageIDStr,
      user,
      skipPinned,
      attachments,
      botsOrUsers,
    );

    if (optionsResult.err) {
      this.logger.warn(
        {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          error: optionsResult.val,
        },
        "Invalid prune options provided",
      );

      await interaction.reply({
        embeds: [pruneErrorView(optionsResult.val)],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const options = optionsResult.val;

    this.logger.debug(
      {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        maxDeleteCount: options.maxDeleteCount,
        afterMessageID: options.afterMessageID,
        beforeMessageID: options.beforeMessageID,
        userTargeted: options.user?.id,
      },
      "Starting prune command execution",
    );

    // Execute prune operation
    const pruneResult = await this.pruneMessageService.pruneMessages(
      interaction.channel,
      options,
    );

    if (pruneResult.err) {
      this.logger.warn(
        {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          error: pruneResult.val,
        },
        "Prune operation failed",
      );

      await interaction.reply({
        embeds: [pruneErrorView(pruneResult.val)],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const result = pruneResult.val;

    await interaction.reply({
      embeds: [pruneSuccessView(result)],
      flags: MessageFlags.Ephemeral,
    });

    this.logger.info(
      {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        deletedCount: result.deletedCount,
        executorId: interaction.user.id,
        userSummary: result.userDeletedSummary,
      },
      "Successfully completed prune command execution",
    );
  }
}
