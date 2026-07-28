import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ModViewDependencies } from "../ModViewSession";
import { openModView, respondWithModViewError } from "../ModViewSession";

export class ModViewCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("modview")
    .setDescription("Show the full moderation view for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("The user to show the moderation view for.")
        .setRequired(true),
    )
    .toJSON();

  constructor(private readonly deps: ModViewDependencies) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const targetUser = interaction.options.getUser("user");
    const log = this.deps.logger.child({
      guildId: interaction.guildId,
      targetId: targetUser?.id ?? null,
      executorId: interaction.user.id,
    });

    if (!targetUser) {
      log.warn("Mod view target could not be resolved");
      await respondWithModViewError(
        interaction,
        "That user could not be resolved.",
      );
      return;
    }

    // The application layer lets infrastructure errors throw, so this is the
    // only place a failed query becomes a message rather than a dead
    // interaction.
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
}
