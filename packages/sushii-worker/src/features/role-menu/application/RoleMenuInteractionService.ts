import type { GuildMember } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import {
  computeRoleMenuSelectionChanges,
  findRolesNotInMenu,
} from "../domain/services/roleMenuSelection";

interface MenuRoleData {
  roleId: string;
  label: string;
}

interface RoleInteractionResult {
  action: "added" | "removed";
  roleId: string;
  description: string;
}

export class RoleMenuInteractionService {
  constructor(private readonly logger: Logger) {}

  async handleButtonInteraction(
    member: GuildMember,
    roleId: string,
    menuRoles: MenuRoleData[],
    requiredRole?: string,
    maxRoles?: number,
  ): Promise<Result<RoleInteractionResult, string>> {
    this.logger.debug(
      {
        userId: member.id,
        guildId: member.guild.id,
        roleId,
      },
      "Handling button interaction",
    );

    // Role must still be part of the menu (old messages may have stale buttons)
    if (!menuRoles.some((r) => r.roleId === roleId)) {
      return Err(
        `<@&${roleId}> is no longer part of this role menu. Ask a server moderator to update the menu message.`,
      );
    }

    try {
      // Check if removing or adding role
      const isRemovingRole = member.roles.cache.has(roleId);

      // Check required role (but allow removing roles without required role)
      if (
        requiredRole &&
        !member.roles.cache.has(requiredRole) &&
        !isRemovingRole
      ) {
        return Err(
          `You need to have the <@&${requiredRole}> role to use this menu.`,
        );
      }

      // Check max roles (only when adding)
      if (!isRemovingRole && maxRoles) {
        const menuRolesSet = new Set(menuRoles.map((r) => r.roleId));
        const memberSelectedRoles = member.roles.cache.filter((role) =>
          menuRolesSet.has(role.id),
        );

        if (memberSelectedRoles.size >= maxRoles) {
          return Err(
            `You can only have a max of ${maxRoles} roles from this menu. You will need to remove one of your roles before you can add another.`,
          );
        }
      }

      // Perform role action
      let description: string;
      if (isRemovingRole) {
        await member.roles.remove(roleId);
        description = `Removed role <@&${roleId}>`;
      } else {
        try {
          await member.roles.add(roleId);
          description = `Added role <@&${roleId}>`;
        } catch (err) {
          if (err instanceof DiscordAPIError) {
            if (err.code === RESTJSONErrorCodes.UnknownRole) {
              return Err(
                "This role no longer exists - please notify the server moderators.",
              );
            }
            if (err.code === RESTJSONErrorCodes.MissingPermissions) {
              return Err(
                "I don't have permission to add this role to you - please notify the server moderators.",
              );
            }
          }
          throw err;
        }
      }

      return Ok({
        action: isRemovingRole ? "removed" : "added",
        roleId,
        description,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: member.id, roleId },
        "Failed to handle button interaction",
      );

      if (error instanceof DiscordAPIError) {
        return Err(error.message);
      }

      throw new Error("Failed to handle button interaction", { cause: error });
    }
  }

  async handleSelectMenuInteraction(
    member: GuildMember,
    selectedRoleIds: string[],
    menuRoles: MenuRoleData[],
    requiredRole?: string,
    maxRoles?: number,
  ): Promise<
    Result<
      { addedRoles: string[]; removedRoles: string[]; description: string },
      string
    >
  > {
    this.logger.debug(
      {
        userId: member.id,
        guildId: member.guild.id,
        selectedRoleIds,
      },
      "Handling select menu interaction",
    );

    const menuRoleIds = menuRoles.map((r) => r.roleId);

    // Selected roles must still be part of the menu (old messages may be stale)
    const rolesNotInMenu = findRolesNotInMenu(selectedRoleIds, menuRoleIds);
    if (rolesNotInMenu.length > 0) {
      const mentions = rolesNotInMenu.map((r) => `<@&${r}>`).join(", ");
      return Err(
        `${mentions} ${rolesNotInMenu.length === 1 ? "is" : "are"} no longer part of this role menu. Deselect ${rolesNotInMenu.length === 1 ? "it" : "them"} and try again, or ask a server moderator to update the menu message.`,
      );
    }

    // Check required role
    if (requiredRole && !member.roles.cache.has(requiredRole)) {
      return Err(
        `You need to have the <@&${requiredRole}> role to use this menu.`,
      );
    }

    // Check max roles (message max_values may be stale if the menu changed)
    const selectedCount = new Set(selectedRoleIds).size;
    if (maxRoles && selectedCount > maxRoles) {
      return Err(
        `You can only have a max of ${maxRoles} roles from this menu. Select fewer roles and try again.`,
      );
    }

    // Single-role add/remove avoids overwriting roles via a stale member cache
    const { toAdd: addedRoles, toRemove: removedRoles } =
      computeRoleMenuSelectionChanges({
        currentRoleIds: member.roles.cache.keys(),
        selectedRoleIds,
        menuRoleIds,
      });

    try {
      for (const roleId of addedRoles) {
        await member.roles.add(roleId);
      }

      for (const roleId of removedRoles) {
        await member.roles.remove(roleId);
      }

      // Generate description
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

      return Ok({
        addedRoles,
        removedRoles,
        description: description.trim(),
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: member.id, selectedRoleIds },
        "Failed to handle select menu interaction",
      );

      if (error instanceof DiscordAPIError) {
        return Err(error.message);
      }

      throw new Error("Failed to handle select menu interaction", {
        cause: error,
      });
    }
  }
}
