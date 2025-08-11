import * as Sentry from "@sentry/node";
import { sleep } from "bun";
import type { ButtonInteraction } from "discord.js";
import { DiscordAPIError, EmbedBuilder, RESTJSONErrorCodes } from "discord.js";
import { MessageFlags } from "discord.js";

import Color from "../../utils/colors";
import customIds from "../customIds";
import { ButtonHandler } from "../handlers";
import {
  getRoleMenuMaxRoles,
  getRoleMenuMessageButtonRoles,
  getRoleMenuRequiredRole,
} from "./ids";

export default class RoleMenuButtonHandler extends ButtonHandler {
  customIDMatch = customIds.roleMenuButton.match;

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    // -------------------------------------------------------------------------
    // Check if removing or adding role

    const customIDMatch = customIds.roleMenuButton.match(interaction.customId);
    if (!customIDMatch) {
      throw new Error("No role to add or remove");
    }

    const roleToAddOrRemove = customIDMatch.params.roleId;

    // If user already has role -> remove it
    // If user doesn't have role -> add it
    const isRemovingRole =
      interaction.member.roles.cache.has(roleToAddOrRemove);

    // -------------------------------------------------------------------------
    // Check if member has required role, but allow them to remove roles

    const requiredRole = getRoleMenuRequiredRole(interaction.message);
    if (
      requiredRole &&
      !interaction.member.roles.cache.has(requiredRole) &&
      !isRemovingRole // Allow removing roles without required role
    ) {
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

    // -------------------------------------------------------------------------
    // Check max roles

    const maxRoles = getRoleMenuMaxRoles(interaction.message);

    const menuRoles = getRoleMenuMessageButtonRoles(interaction.message);
    const menuRolesSet = new Set(menuRoles.map((r) => r.roleId));

    // Check number of roles the member already has selected from this menu
    const memberAlreadySelectedRoles = new Set(
      interaction.member.roles.cache.filter((role) =>
        menuRolesSet.has(role.id),
      ),
    );

    // Only check for max roles if user is adding a role, not removing
    if (
      !isRemovingRole &&
      maxRoles &&
      memberAlreadySelectedRoles.size >= maxRoles
    ) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Color.Error)
            .setTitle("Failed to update your roles")
            .setDescription(
              `You can only have a max of ${maxRoles} roles from this menu. You will need to remove one of your roles before you can add another.`,
            )
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    // -------------------------------------------------------------------------
    // Add role or remove role

    let description;
    try {
      if (isRemovingRole) {
        await interaction.member.roles.remove(roleToAddOrRemove);

        description = `Removed role <@&${roleToAddOrRemove}>`;
      } else {
        try {
          await interaction.member.roles.add(roleToAddOrRemove);
        } catch (err) {
          if (err instanceof DiscordAPIError) {
            // Default to the message if it's some other errors
            let desc = err.message;

            if (err.code === RESTJSONErrorCodes.UnknownRole) {
              desc =
                "Uh oh, this role no longer exists - please notify the server moderators.";
            } else if (err.code === RESTJSONErrorCodes.MissingPermissions) {
              desc =
                "Uh oh, I don't have permission to add this role to you - please notify the server moderators.";
            } else {
              // Capture any other errors for now
              Sentry.captureException(err, {
                tags: {
                  type: "role_menu_button",
                  guildId: interaction.guildId,
                },
              });
            }

            await interaction.reply({
              embeds: [
                new EmbedBuilder()
                  .setColor(Color.Error)
                  .setTitle("Failed to update your roles")
                  .setDescription(desc),
              ],
              flags: MessageFlags.Ephemeral,
            });

            // Prevent throwing error again
            return;
          }

          // Uh oh
          throw err;
        }

        description = `Added role <@&${roleToAddOrRemove}>`;
      }
    } catch (err) {
      if (err instanceof DiscordAPIError) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(Color.Error)
              .setTitle("Failed to update your roles")
              .setDescription(err.message)
              .toJSON(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      throw err;
    }

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
    await reply.delete();
  }
}
