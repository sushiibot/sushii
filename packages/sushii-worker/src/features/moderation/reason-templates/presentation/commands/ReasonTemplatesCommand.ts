import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ReasonTemplateService } from "../../application/ReasonTemplateService";
import {
  REASON_TEMPLATES_PANEL_EMOJIS,
  buildListMessage,
} from "../views/ReasonTemplatesPanelView";

export class ReasonTemplatesCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("reason-templates")
    .setDescription("Manage reason templates shared by all mods.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(
    private readonly reasonTemplateService: Pick<ReasonTemplateService, "list">,
    private readonly emojiRepository: Pick<BotEmojiRepository, "getEmojis">,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Must be in guild.");
    }

    const [list, emojis] = await Promise.all([
      this.reasonTemplateService.list(interaction.guildId, 1),
      this.emojiRepository.getEmojis(REASON_TEMPLATES_PANEL_EMOJIS),
    ]);

    await interaction.reply(buildListMessage(list, emojis));
  }
}
