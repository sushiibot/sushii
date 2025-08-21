import { sleep } from "bun";
import type { ButtonInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/interactions/handlers";
import Color from "@/utils/colors";

import type { RoleMenuInteractionService } from "../../application/RoleMenuInteractionService";
import {
  getRoleMenuMaxRoles,
  getRoleMenuMessageButtonRoles,
  getRoleMenuRequiredRole,
} from "../utils/roleMenuMessageParser";

export class RoleMenuButtonHandler extends ButtonHandler {
  customIDMatch = customIds.roleMenuButton.match;

  constructor(
    private readonly roleMenuInteractionService: RoleMenuInteractionService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const customIDMatch = customIds.roleMenuButton.match(interaction.customId);
    if (!customIDMatch) {
      throw new Error("No role to add or remove");
    }

    const roleToAddOrRemove = customIDMatch.params.roleId;
    const requiredRole = getRoleMenuRequiredRole(interaction.message);
    const maxRoles = getRoleMenuMaxRoles(interaction.message);
    const menuRoles = getRoleMenuMessageButtonRoles(interaction.message);

    const result = await this.roleMenuInteractionService.handleButtonInteraction(
      interaction.member,
      roleToAddOrRemove,
      menuRoles,
      requiredRole || undefined,
      maxRoles || undefined,
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

    const reply = await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Color.Success)
          .setTitle("Your roles have been updated")
          .setDescription(description)
          .toJSON(),
      ],
      flags: MessageFlags.Ephemeral,
    });

    // Delete reply after 5 seconds
    await sleep(5000);
    
    try {
      await reply.delete();
    } catch (error) {
      // Ignore errors when deleting (e.g., if already deleted)
      this.logger.debug({ err: error }, "Failed to delete interaction reply");
    }
  }
}