import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { ModViewDependencies } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import { openModViewOrReportError } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import { getErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

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
    private readonly modViewDependencies: ModViewDependencies,
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

    // The public-server gate lives in ModViewService/LookupTabBuilder now —
    // the Lookup tab always renders and explains itself when unavailable, so
    // a hard refusal here would only disagree with what /modview already
    // shows for the same target.
    const targetUser = interaction.options.getUser("user");
    if (!targetUser) {
      await interaction.reply(getErrorMessage("Error", "No user provided"));
      return;
    }

    log.info({ targetUserId: targetUser.id }, "Looking up user");

    await openModViewOrReportError(
      interaction,
      targetUser,
      this.modViewDependencies,
      "lookup",
    );
  }
}
