import type { ChatInputCommandInteraction } from "discord.js";
import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { SlowmodeService } from "../../application/SlowmodeService";
import { slowmodeErrorView, slowmodeSuccessView } from "../views/SlowmodeView";

enum SlowmodeOption {
  Duration = "duration",
  ChannelOption = "channel",
}

export class SlowmodeCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Adjust slowmode for channels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName(SlowmodeOption.Duration)
        .setDescription(
          "Duration to set slowmode to (Example: 5s or 1m). Set to 0 to disable.",
        )
        .setRequired(true),
    )
    .addChannelOption((o) =>
      o
        .setName(SlowmodeOption.ChannelOption)
        .setDescription(
          "Channel to set slowmode for. Defaults to the current channel.",
        )
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.AnnouncementThread,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
        )
        .setRequired(false),
    )
    .toJSON();

  constructor(
    private readonly slowmodeService: SlowmodeService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const durationStr = interaction.options.getString(SlowmodeOption.Duration);
    if (!durationStr) {
      throw new Error("Missing duration");
    }

    const channelOption = interaction.options.getChannel(
      SlowmodeOption.ChannelOption,
      false,
    );

    const targetChannel = channelOption || interaction.channel;

    if (!targetChannel) {
      throw new Error("Missing channel");
    }

    // Validate that this is a text-based channel that supports slowmode
    if (!targetChannel.isTextBased()) {
      await interaction.reply({
        embeds: [slowmodeErrorView("Channel must be a text based channel")],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    this.logger.debug(
      {
        guildId: interaction.guildId,
        channelId: targetChannel.id,
        durationStr,
      },
      "Updating channel slowmode",
    );

    const updateResult = await this.slowmodeService.updateSlowmode(
      targetChannel,
      durationStr,
    );

    if (updateResult.err) {
      this.logger.warn(
        {
          error: updateResult.val,
          guildId: interaction.guildId,
          channelId: targetChannel.id,
          durationStr,
        },
        "Failed to update slowmode",
      );

      await interaction.reply({
        embeds: [slowmodeErrorView(updateResult.val)],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const result = updateResult.val;

    await interaction.reply({
      embeds: [slowmodeSuccessView(targetChannel.id, result)],
      flags: MessageFlags.Ephemeral,
    });

    this.logger.info(
      {
        guildId: interaction.guildId,
        channelId: targetChannel.id,
        channelName: targetChannel.name,
        previousSeconds: result.previousSlowmode.asSeconds,
        newSeconds: result.newSlowmode.asSeconds,
        executorId: interaction.user.id,
      },
      "Successfully updated channel slowmode via command",
    );
  }
}
