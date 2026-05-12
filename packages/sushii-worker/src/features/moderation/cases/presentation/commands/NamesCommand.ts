import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { getErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { NamesUserService } from "../../application/NamesUserService";
import { buildUserNamesReply } from "../views/UserNamesView";

export class NamesCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("names")
    .setDescription("Show name history for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to show name history for.")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly namesUserService: NamesUserService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const log = this.logger.child({
      command: "names",
      guildId: interaction.guildId,
      executorId: interaction.user.id,
    });

    const targetUser = interaction.options.getUser("user");
    if (!targetUser) {
      await interaction.reply(getErrorMessage("Error", "No user provided"));
      return;
    }

    try {
      const result = await this.namesUserService.getNames(
        interaction.guildId,
        targetUser.id,
      );

      if (!result.ok) {
        log.warn(
          { err: result.val, targetUserId: targetUser.id },
          "Failed to get user name history",
        );
        await interaction.reply(getErrorMessage("Error", result.val));
        return;
      }

      if (result.val.eligibilityDenied) {
        await interaction.reply(
          getErrorMessage(
            "Access Denied",
            "This user is not a current member of this server and has no moderation history here.",
            true,
          ),
        );
        return;
      }

      const member = interaction.options.getMember("user");

      const message = buildUserNamesReply(
        targetUser,
        member,
        result.val,
        interaction.guildId,
      );

      await interaction.reply(message);
    } catch (error) {
      log.error(
        { err: error, targetUserId: targetUser.id },
        "Unexpected error fetching user name history",
      );
      await interaction.reply(
        getErrorMessage("Error", "An unexpected error occurred."),
      );
    }
  }
}
