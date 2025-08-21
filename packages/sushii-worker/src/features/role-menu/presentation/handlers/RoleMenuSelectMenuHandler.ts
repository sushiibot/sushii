import type { AnySelectMenuInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { SelectMenuHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { RoleMenuInteractionService } from "../../application/RoleMenuInteractionService";
import {
  getRoleMenuMessageSelectRoles,
  getRoleMenuRequiredRole,
} from "../utils/roleMenuMessageParser";

export class RoleMenuSelectMenuHandler extends SelectMenuHandler {
  customIDMatch = customIds.roleMenuSelect.match;

  constructor(
    private readonly roleMenuInteractionService: RoleMenuInteractionService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const requiredRole = getRoleMenuRequiredRole(interaction.message);
    const menuRoles = getRoleMenuMessageSelectRoles(interaction.message);

    const result =
      await this.roleMenuInteractionService.handleSelectMenuInteraction(
        interaction.member,
        interaction.values,
        menuRoles,
        requiredRole || undefined,
      );

    if (result.err) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Color.Error)
            .setTitle("Failed to update your roles")
            .setDescription(result.val)
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { description } = result.val;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Color.Success)
          .setTitle("Your roles have been updated")
          .setDescription(description)
          .toJSON(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
