import type {
  ContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from "discord.js";
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import { createUserInfoEmbed } from "@/features/user-profile/presentation/views/UserInfoView";
import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import type { ModViewDependencies } from "../ModViewEntry";
import { openModViewOrReportError } from "../ModViewEntry";

/**
 * No `setDefaultMemberPermissions`: the entry has to stay in every member's
 * Apps menu because it doubles as the non-moderator account-info glance. The
 * moderation branch is gated at invocation time instead.
 */
export class ModViewContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("Mod View")
    .setType(ApplicationCommandType.User)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(
    private readonly deps: ModViewDependencies,
    private readonly userLevelRepository: UserLevelRepository,
  ) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    if (!interaction.isUserContextMenuCommand()) {
      throw new Error("Not a user context menu command");
    }

    const { targetUser } = interaction;

    if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      await this.replyBasicInfo(interaction);
      return;
    }

    await openModViewOrReportError(
      interaction,
      targetUser,
      this.deps,
      "overview",
      true,
    );
  }

  /**
   * The non-moderator fallback: public account information only, private to
   * the member who asked, so right-clicking cannot be used to spam a channel.
   */
  private async replyBasicInfo(
    interaction: UserContextMenuCommandInteraction<"cached">,
  ): Promise<void> {
    const { targetUser, targetMember } = interaction;

    const [guildLevelResult, globalLevelResult] = await Promise.allSettled([
      this.userLevelRepository.getUserGuildLevel(
        interaction.guildId,
        targetUser.id,
      ),
      this.userLevelRepository.getUserGlobalLevel(targetUser.id),
    ]);

    if (guildLevelResult.status === "rejected") {
      this.deps.logger.error(
        { err: guildLevelResult.reason, targetId: targetUser.id },
        "Failed to fetch guild level for mod view fallback",
      );
    }

    if (globalLevelResult.status === "rejected") {
      this.deps.logger.error(
        { err: globalLevelResult.reason, targetId: targetUser.id },
        "Failed to fetch global level for mod view fallback",
      );
    }

    const embed = createUserInfoEmbed(
      targetUser,
      targetMember ?? undefined,
      guildLevelResult.status === "fulfilled" ? guildLevelResult.value : null,
      globalLevelResult.status === "fulfilled" ? globalLevelResult.value : null,
    );

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}
