import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { isPublicServer } from "@/features/moderation/shared/domain/services/PublicServerValidationService";
import { getErrorMessage } from "@/interactions/responses/error";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { LookupUserService } from "../../application/LookupUserService";
import {
  buildUserLookupPageContainer,
  buildUserLookupPages,
} from "../views/UserLookupView";

export class LookupCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up cross-server bans for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to show server bans for.")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly lookupUserService: LookupUserService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const log = this.logger.child({
      command: "lookup",
      guildId: interaction.guildId,
      userId: interaction.user.id,
    });

    // Check if server meets public server requirements
    if (!isPublicServer(interaction.guild)) {
      log.info(
        {
          guildId: interaction.guildId,
          guildName: interaction.guild.name,
          memberCount: interaction.guild.memberCount,
        },
        "Lookup command denied - server doesn't meet requirements",
      );

      const msg = getErrorMessage(
        "Access Restricted",
        "This feature is only available for public (discoverable) servers with 1000+ members. Partnered and verified servers are also eligible.",
      );
      await interaction.reply(msg);
      return;
    }

    const targetUser = interaction.options.getUser("user");
    if (!targetUser) {
      await interaction.reply(getErrorMessage("Error", "No user provided"));
      return;
    }

    log.info({ targetUserId: targetUser.id }, "Looking up user");

    const lookupResult = await this.lookupUserService.lookupUser(
      interaction.guildId,
      targetUser.id,
    );

    if (!lookupResult.ok) {
      log.error(
        { error: lookupResult.val, targetUserId: targetUser.id },
        "Failed to lookup user",
      );
      const msg = getErrorMessage("Error", lookupResult.val);
      await interaction.reply(msg);
      return;
    }

    let member;
    try {
      member = await interaction.guild.members.fetch(targetUser.id);
    } catch {
      member = null;
    }

    const { crossServerBans, currentGuildLookupOptIn } = lookupResult.val;
    const pages = buildUserLookupPages(crossServerBans, currentGuildLookupOptIn);

    const paginator = new ComponentsV2Paginator({
      interaction,
      pageSize: 1,
      callbacks: {
        fetchPage: async (pageIndex) =>
          pages[pageIndex] ? [pages[pageIndex]] : [],
        getTotalCount: async () => pages.length,
        renderContainer: ([pageBans], state, navButtons) =>
          buildUserLookupPageContainer(
            targetUser,
            member,
            crossServerBans.length,
            pageBans ?? [],
            currentGuildLookupOptIn,
            navButtons,
            state.isDisabled,
          ),
      },
    });

    await paginator.start(false);

    log.info(
      {
        targetUserId: targetUser.id,
        crossServerBans: crossServerBans.length,
      },
      "User lookup completed",
    );
  }
}
