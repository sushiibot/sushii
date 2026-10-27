import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import { normalizeQuery } from "../application/helpIndex";
import type { HelpRenderer } from "./HelpRenderer";

const HELP_SEARCH_OPTION = "command";

export class HelpCommand extends SlashCommandHandler {
  readonly command = new SlashCommandBuilder()
    .setName("help")
    .setDescription("See what sushii can do")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName(HELP_SEARCH_OPTION)
        .setDescription("Search for a command")
        .setAutocomplete(true),
    )
    .toJSON();

  constructor(private readonly renderer: HelpRenderer) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString(HELP_SEARCH_OPTION)?.trim();
    const guildId = interaction.guildId ?? undefined;
    // /help is hidden from the index, so searching for it shows the tabs.
    const isSearch =
      query !== undefined && !["", "help"].includes(normalizeQuery(query));
    if (!isSearch) {
      const payload = await this.renderer.render(
        "members",
        interaction.memberPermissions,
        guildId,
        interaction.user.id,
      );
      await interaction.reply(payload);
      return;
    }

    const { payload, shareable } = await this.renderer.renderDetail(
      query,
      interaction.memberPermissions,
      guildId,
    );
    // Misses and permission denials only matter to the person searching.
    await interaction.reply(
      shareable
        ? payload
        : { ...payload, flags: payload.flags | MessageFlags.Ephemeral },
    );
  }
}
