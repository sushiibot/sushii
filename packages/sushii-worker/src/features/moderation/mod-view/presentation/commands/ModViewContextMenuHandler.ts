import type {
  ContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from "discord.js";
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import { createUserInfoEmbed } from "@/features/user-profile/presentation/views/UserInfoView";
import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import type { ModViewDependencies } from "../ModViewSession";
import { openModView, respondWithModViewError } from "../ModViewSession";

/**
 * No `setDefaultMemberPermissions`: the entry has to stay in every member's
 * Apps menu because it doubles as the non-moderator account-info glance. The
 * moderation branch is gated at invocation time instead.
 */
export class ModViewContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("Mod View")
    .setType(ApplicationCommandType.User)
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
    const log = this.deps.logger.child({
      guildId: interaction.guildId,
      targetId: targetUser.id,
      executorId: interaction.user.id,
    });

    if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      await this.replyBasicInfo(interaction);
      return;
    }

    try {
      await openModView(interaction, targetUser, this.deps);
    } catch (err) {
      log.error(
        { err, guildId: interaction.guildId, targetId: targetUser.id },
        "Failed to open mod view",
      );
      await respondWithModViewError(
        interaction,
        "Something went wrong loading this user's moderation data.",
      );
    }
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
