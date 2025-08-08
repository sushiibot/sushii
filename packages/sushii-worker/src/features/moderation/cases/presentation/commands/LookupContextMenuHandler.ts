import type {
  ContextMenuCommandInteraction} from "discord.js";
import {
  ContextMenuCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { ApplicationCommandType } from "discord.js";
import type { Logger } from "pino";

import ContextMenuHandler from "@/interactions/handlers/ContextMenuHandler";
import { createUserInfoEmbed } from "@/features/user-profile/presentation/views/UserInfoView";

import type { LookupUserService } from "../../application/LookupUserService";
import { buildUserHistoryEmbeds } from "../views/HistoryView";
import { buildUserLookupEmbed } from "../views/UserLookupView";

export class LookupContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("User Info")
    .setType(ApplicationCommandType.User)
    .toJSON();

  constructor(
    private readonly lookupUserService: LookupUserService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    if (!interaction.isUserContextMenuCommand()) {
      throw new Error("Not a user context menu command");
    }

    const { targetUser, targetMember } = interaction;

    const log = this.logger.child({
      command: "userInfoContextMenu",
      guildId: interaction.guildId,
      userId: interaction.user.id,
      targetUserId: targetUser.id,
    });

    const isModerator = interaction.memberPermissions.has(
      PermissionFlagsBits.BanMembers,
    );

    const userInfoEmbed = createUserInfoEmbed(
      targetUser,
      targetMember || undefined,
    );

    if (!isModerator) {
      await interaction.reply({
        embeds: [userInfoEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    log.info("Moderator accessing user info context menu");

    // Fetch lookup data for moderators
    const lookupResult = await this.lookupUserService.lookupUser(
      interaction.guildId,
      targetUser.id,
    );

    const embeds: EmbedBuilder[] = [new EmbedBuilder(userInfoEmbed)];

    if (lookupResult.ok) {
      // Add lookup embed
      const sushiiMember = interaction.guild.members.me;
      const hasPermission = sushiiMember?.permissions.has(
        PermissionFlagsBits.BanMembers,
      );

      const lookupEmbed = buildUserLookupEmbed(
        targetUser,
        targetMember,
        lookupResult.val,
        {
          botHasBanPermission: hasPermission ?? true,
          showBasicInfo: true,
        },
      );
      embeds.push(lookupEmbed);

      // Add history embeds
      const historyEmbeds = buildUserHistoryEmbeds(
        targetUser,
        targetMember,
        lookupResult.val,
      );
      embeds.push(...historyEmbeds);
    } else {
      log.error(
        { error: lookupResult.val, targetUserId: targetUser.id },
        "Failed to lookup user data",
      );
    }

    // TODO: Add moderation action buttons (Ban, Kick, Mute, Warn) in the future
    // These would require additional UI for collecting reasons, durations, etc.

    await interaction.reply({
      embeds,
      flags: MessageFlags.Ephemeral,
    });

    log.info("Context menu displayed with user info, lookup, and history");
  }
}
