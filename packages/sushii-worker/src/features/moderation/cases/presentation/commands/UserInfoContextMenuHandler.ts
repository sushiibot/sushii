import type { ContextMenuCommandInteraction } from "discord.js";
import {
  ContextMenuCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { ApplicationCommandType } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import { isPublicServer } from "@/features/moderation/shared/domain/services/PublicServerValidationService";
import { createUserInfoEmbed } from "@/features/user-profile/presentation/views/UserInfoView";
import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import type { HistoryUserService } from "../../application/HistoryUserService";
import type { LookupUserService } from "../../application/LookupUserService";
import {
  HISTORY_ACTION_EMOJIS,
  buildUserHistoryContextEmbed,
} from "../views/HistoryView";
import { buildUserLookupContextEmbed } from "../views/UserInfoContextView";

export class UserInfoContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("User Info")
    .setType(ApplicationCommandType.User)
    .toJSON();

  constructor(
    private readonly historyUserService: HistoryUserService,
    private readonly lookupUserService: LookupUserService,
    private readonly emojiRepository: BotEmojiRepository,
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

    // Start with user info embed
    const embeds: EmbedBuilder[] = [new EmbedBuilder(userInfoEmbed)];

    // Fetch history data for moderators
    const historyResultPromise = this.historyUserService.getUserHistory(
      interaction.guildId,
      targetUser.id,
    );

    // Only fetch lookup data if server meets public server requirements
    let lookupResultPromise;
    const canAccessLookup = isPublicServer(interaction.guild);

    if (canAccessLookup) {
      lookupResultPromise = this.lookupUserService.lookupUser(
        interaction.guildId,
        targetUser.id,
      );
    } else {
      log.info(
        {
          guildId: interaction.guildId,
          guildName: interaction.guild.name,
        },
        "Lookup data skipped - server doesn't meet requirements",
      );
    }

    const [historyResult, lookupResult] = await Promise.all([
      historyResultPromise,
      lookupResultPromise,
    ]);

    // Add history embed (case history in current server - recent 3 cases only)
    if (historyResult.ok) {
      const emojis = await this.emojiRepository.getEmojis(
        HISTORY_ACTION_EMOJIS,
      );

      const historyEmbed = buildUserHistoryContextEmbed(
        targetUser,
        targetMember,
        historyResult.val,
        emojis,
      );
      embeds.push(historyEmbed);
    } else {
      log.error(
        { error: historyResult.val, targetUserId: targetUser.id },
        "Failed to get user history data",
      );
    }

    // Add lookup embed (cross-server bans) - only if we fetched it
    if (canAccessLookup && lookupResult) {
      if (lookupResult.ok) {
        const lookupEmbed = buildUserLookupContextEmbed(
          targetUser,
          targetMember,
          lookupResult.val,
          {
            // Don't duplicate basic info since history embeds include it
            showBasicInfo: false,
          },
        );

        embeds.push(lookupEmbed);
      } else {
        log.error(
          { error: lookupResult.val, targetUserId: targetUser.id },
          "Failed to get cross-server ban data",
        );
      }
    }

    // TODO: Add moderation action buttons (Ban, Kick, Mute, Warn) in the future
    // These would require additional UI for collecting reasons, durations, etc.
    await interaction.reply({
      embeds,
      flags: MessageFlags.Ephemeral,
    });

    log.info("Context menu displayed with user info, history, and lookup");
  }
}
