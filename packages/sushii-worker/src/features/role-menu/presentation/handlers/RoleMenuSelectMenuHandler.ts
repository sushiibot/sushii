import type { AnySelectMenuInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import { SelectMenuHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { RoleMenuInteractionService } from "../../application/RoleMenuInteractionService";
import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import { parseRoleMenuSelectCustomId } from "../constants/roleMenuCustomIds";
import {
  getRoleMenuMessageSelectRoles,
  getRoleMenuRequiredRole,
} from "../utils/roleMenuMessageParser";

export class RoleMenuSelectMenuHandler extends SelectMenuHandler {
  // Updated to handle both new and legacy formats
  customIDMatch = (customId: string) => {
    const parsed = parseRoleMenuSelectCustomId(customId);
    return parsed ? { path: customId, index: 0, params: {} } : false;
  };

  constructor(
    private readonly roleMenuInteractionService: RoleMenuInteractionService,
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
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

    const parsedCustomId = parseRoleMenuSelectCustomId(interaction.customId);
    if (!parsedCustomId) {
      throw new Error("Invalid role menu select custom ID");
    }

    let requiredRole: string | undefined;
    let menuRoles: { roleId: string; label: string }[];

    // Try database-first approach for new format
    if (!parsedCustomId.isLegacy && parsedCustomId.menuName) {
      // Get menu configuration from database
      const menuResult = await this.roleMenuManagementService.getMenu(
        interaction.guildId,
        parsedCustomId.menuName,
      );

      if (menuResult.ok) {
        const menu = menuResult.val;
        requiredRole = menu.requiredRole;

        // Get roles from database
        const rolesResult = await this.roleMenuRoleService.getRoles(
          interaction.guildId,
          parsedCustomId.menuName,
        );

        if (rolesResult.ok) {
          menuRoles = rolesResult.val.map((r) => ({
            roleId: r.roleId,
            label:
              interaction.guild.roles.cache.get(r.roleId)?.name || r.roleId,
          }));
        } else {
          // Database error getting roles - fatal error for new messages
          this.logger.error(
            { err: rolesResult.val, menuName: parsedCustomId.menuName },
            "Failed to get menu roles from database",
          );
          throw new Error("Failed to get menu roles from database", {
            cause: rolesResult.val,
          });
        }
      } else {
        // Menu not found in database, show error
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(Color.Error)
              .setTitle("Menu no longer exists")
              .setDescription("This role menu has been deleted.")
              .toJSON(),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } else {
      // Legacy format or fallback - parse from embed
      requiredRole = getRoleMenuRequiredRole(interaction.message) || undefined;
      menuRoles = getRoleMenuMessageSelectRoles(interaction.message);
    }

    const result =
      await this.roleMenuInteractionService.handleSelectMenuInteraction(
        interaction.member,
        interaction.values,
        menuRoles,
        requiredRole,
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
