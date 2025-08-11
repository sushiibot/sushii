import type { AnySelectMenuInteraction } from "discord.js";
import { DiscordAPIError, EmbedBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import logger from "@/shared/infrastructure/logger";

import Color from "../../utils/colors";
import customIds from "../customIds";
import { SelectMenuHandler } from "../handlers";
import { getRoleMenuMessageSelectRoles, getRoleMenuRequiredRole } from "./ids";

export default class RoleMenuSelectMenuHandler extends SelectMenuHandler {
  customIDMatch = customIds.roleMenuSelect.match;

  async handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const requiredRole = getRoleMenuRequiredRole(interaction.message);
    if (requiredRole && !interaction.member.roles.cache.has(requiredRole)) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Color.Error)
            .setTitle("Failed to update your roles")
            .setDescription(
              `You need to have the <@&${requiredRole}> role to use this menu.`,
            )
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const menuRoles = getRoleMenuMessageSelectRoles(interaction.message);

    // Select menu roles -- this can be 0 when clearing all roles
    const selectedRolesSet = new Set(interaction.values);

    // Updated total member roles
    const memberNewRoles = new Set(interaction.member.roles.cache.keys());

    // Keep track of which ones are added and removed to show user
    const addedRoles = [];
    const removedRoles = [];

    // Add new selected roles
    for (const addRoleId of interaction.values) {
      // Only add if member doesn't already have it, add to addedRoles before
      // adding to memberNewRoles otherwise this is always false
      if (!memberNewRoles.has(addRoleId)) {
        addedRoles.push(addRoleId);
      }

      memberNewRoles.add(addRoleId);
    }

    // Remove roles that were *not* selected
    for (const role of menuRoles) {
      // If role is available in menu AND is NOT selected AND member has it -> remove it
      if (
        !selectedRolesSet.has(role.roleId) &&
        memberNewRoles.has(role.roleId)
      ) {
        memberNewRoles.delete(role.roleId);
        removedRoles.push(role.roleId);
      }
    }

    let description = "";
    if (addedRoles.length > 0) {
      const addedRolesMentions = addedRoles.map((r) => `<@&${r}>`).join(", ");
      description += `Added roles ${addedRolesMentions}\n`;
    }

    if (removedRoles.length > 0) {
      const removedRolesMentions = removedRoles
        .map((r) => `<@&${r}>`)
        .join(", ");
      description += `Removed roles ${removedRolesMentions}`;
    }

    if (addedRoles.length === 0 && removedRoles.length === 0) {
      description = "No roles were added or removed";
    }

    try {
      await interaction.member.roles.set(Array.from(memberNewRoles));
    } catch (err) {
      logger.warn({ err }, "Failed to update roles via select menu rolemenu ");

      let desc;
      if (err instanceof DiscordAPIError) {
        desc = err.message;
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Color.Error)
            .setTitle("Failed to update your roles")
            .setDescription(desc || "An unknown error occurred")
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

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
