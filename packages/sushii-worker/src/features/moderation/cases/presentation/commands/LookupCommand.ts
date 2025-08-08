import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";
import {
  getErrorMessage,
  getErrorMessageEdit,
} from "@/interactions/responses/error";

import type { LookupUserService } from "../../application/LookupUserService";
import { buildUserLookupEmbed } from "../views/UserLookupView";

export class LookupCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up user information and moderation history.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up.")
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

    const targetUser = interaction.options.getUser("user");
    if (!targetUser) {
      await interaction.reply(getErrorMessage("Error", "No user provided"));
      return;
    }

    await interaction.deferReply();

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
      const editMsg = getErrorMessageEdit("Error", lookupResult.val);
      await interaction.editReply(editMsg);
      return;
    }

    const sushiiMember = interaction.guild.members.me;
    const hasPermission = sushiiMember?.permissions.has(
      PermissionFlagsBits.BanMembers,
    );

    let member;
    try {
      member = await interaction.guild.members.fetch(targetUser.id);
    } catch {
      member = null;
    }

    const embed = buildUserLookupEmbed(targetUser, member, lookupResult.val, {
      botHasBanPermission: hasPermission ?? true,
      showBasicInfo: true,
    });

    log.info(
      {
        targetUserId: targetUser.id,
        totalCases: lookupResult.val.totalCases,
      },
      "User lookup completed",
    );

    await interaction.editReply({ embeds: [embed] });
  }
}
