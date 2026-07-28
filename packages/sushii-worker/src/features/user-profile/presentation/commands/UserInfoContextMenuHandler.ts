import type { ContextMenuCommandInteraction, GuildMember } from "discord.js";
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
} from "discord.js";
import type { Logger } from "pino";

import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import { createUserInfoEmbed } from "../views/UserInfoView";

/**
 * The always-visible counterpart to `/userinfo` and Mod View's moderator
 * branch — right-click account info for everyone, guild-optional like
 * `UserInfoCommand`, so it stays usable in DMs.
 */
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

  constructor(
    private readonly userLevelRepository: UserLevelRepository,
    private readonly logger: Logger,
  ) {
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

    const [guildLevelResult, globalLevelResult] = await Promise.allSettled([
      guildId
        ? this.userLevelRepository.getUserGuildLevel(guildId, targetUser.id)
        : Promise.resolve(null),
      this.userLevelRepository.getUserGlobalLevel(targetUser.id),
    ]);

    if (guildLevelResult.status === "rejected") {
      this.logger.error(
        { err: guildLevelResult.reason, targetId: targetUser.id, guildId },
        "Failed to fetch guild level for User Info context menu",
      );
    }

    if (globalLevelResult.status === "rejected") {
      this.logger.error(
        { err: globalLevelResult.reason, targetId: targetUser.id },
        "Failed to fetch global level for User Info context menu",
      );
    }

    const embed = createUserInfoEmbed(
      targetUser,
      targetMember,
      guildLevelResult.status === "fulfilled" ? guildLevelResult.value : null,
      globalLevelResult.status === "fulfilled" ? globalLevelResult.value : null,
    );

    await interaction.reply({ embeds: [embed] });
  }
}
