import {
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import { SlowmodeService } from "../../application/SlowmodeService";
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
      [ChannelType.GuildText],
    );

    const targetChannel = channelOption || interaction.channel;

    if (!targetChannel) {
      throw new Error("Missing channel");
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
      targetChannel.id,
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
      embeds: [slowmodeSuccessView(result)],
      flags: MessageFlags.Ephemeral,
    });

    this.logger.info(
      {
        guildId: interaction.guildId,
        channelId: result.channelId,
        channelName: result.channelName,
        previousSeconds: result.previousSlowmode.asSeconds,
        newSeconds: result.newSlowmode.asSeconds,
        executorId: interaction.user.id,
      },
      "Successfully updated channel slowmode via command",
    );
  }
}
