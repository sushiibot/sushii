import type { ContextMenuCommandInteraction, GuildMember } from "discord.js";
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from "discord.js";

import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import { createUserInfoEmbed } from "../views/UserInfoView";

/** Ephemeral so repeated right-clicks can't spam a channel. */
export class UserInfoContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("User Info")
    .setType(ApplicationCommandType.User)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .toJSON();

  constructor(private readonly userLevelRepository: UserLevelRepository) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.isUserContextMenuCommand()) {
      throw new Error("Not a user context menu command");
    }

    const { targetUser, guildId } = interaction;
    // Only a cached-guild interaction resolves `targetMember` to a real
    // `GuildMember` instance; a DM or uncached-guild invocation leaves it as
    // raw API data (or null) that `createUserInfoEmbed` isn't built for.
    const targetMember: GuildMember | undefined = interaction.inCachedGuild()
      ? (interaction.targetMember ?? undefined)
      : undefined;

    const [guildLevel, globalLevel] = await Promise.all([
      guildId
        ? this.userLevelRepository.getUserGuildLevel(guildId, targetUser.id)
        : Promise.resolve(null),
      this.userLevelRepository.getUserGlobalLevel(targetUser.id),
    ]);

    const embed = createUserInfoEmbed(
      targetUser,
      targetMember,
      guildLevel,
      globalLevel,
    );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
