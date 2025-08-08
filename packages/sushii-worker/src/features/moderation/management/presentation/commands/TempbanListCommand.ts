import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import type { TempBanListService } from "../../application/TempBanListService";
import {
  chunkTempBansByLength,
  tempBanListEmptyView,
  tempBanListErrorView,
  tempBanListView,
} from "../views/TempbanListView";

export class TempbanListCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField().add("BanMembers");

  command = new SlashCommandBuilder()
    .setName("tempban-list")
    .setDescription("List all active temporary bans in the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(
    private readonly tempBanListService: TempBanListService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    this.logger.debug(
      { guildId: interaction.guildId },
      "Getting temporary ban list",
    );

    const tempBansResult = await this.tempBanListService.getActiveTempBans(
      interaction.guildId,
    );

    if (tempBansResult.err) {
      this.logger.error(
        { error: tempBansResult.val, guildId: interaction.guildId },
        "Failed to get temporary bans",
      );

      await interaction.reply({
        embeds: [tempBanListErrorView()],
        ephemeral: true,
      });

      return;
    }

    const tempBans = tempBansResult.val;

    if (tempBans.length === 0) {
      await interaction.reply({
        embeds: [tempBanListEmptyView()],
      });

      return;
    }

    // Split into multiple embeds if description is too long
    const chunks = chunkTempBansByLength(tempBans);
    const embeds = chunks.map((chunk, index) =>
      tempBanListView(chunk, index, chunks.length),
    );

    await interaction.reply({
      embeds,
    });

    this.logger.debug(
      { guildId: interaction.guildId, count: tempBans.length },
      "Successfully displayed temporary ban list",
    );
  }
}
