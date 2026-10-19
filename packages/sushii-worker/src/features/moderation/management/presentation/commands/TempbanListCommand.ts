import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { TempBanListService } from "../../application/TempBanListService";
import {
  chunkTempBansByLength,
  tempBanListEmptyView,
  tempBanListView,
} from "../views/TempbanListView";

export class TempbanListCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField().add("BanMembers");

  command = new SlashCommandBuilder()
    .setName("tempban-list")
    .setDescription("List all active temporary bans in the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
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

    const tempBans = await this.tempBanListService.getActiveTempBans(
      interaction.guildId,
    );

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
