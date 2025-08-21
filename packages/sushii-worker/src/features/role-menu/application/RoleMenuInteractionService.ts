import type { GuildMember } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

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
    this.logger.debug({ 
      userId: member.id, 
      guildId: member.guild.id, 
      roleId 
    }, "Handling button interaction");

    try {
      // Check if removing or adding role
      const isRemovingRole = member.roles.cache.has(roleId);

      // Check required role (but allow removing roles without required role)
      if (requiredRole && !member.roles.cache.has(requiredRole) && !isRemovingRole) {
        return Err(`You need to have the <@&${requiredRole}> role to use this menu.`);
      }

      // Check max roles (only when adding)
      if (!isRemovingRole && maxRoles) {
        const menuRolesSet = new Set(menuRoles.map(r => r.roleId));
        const memberSelectedRoles = member.roles.cache.filter(role => menuRolesSet.has(role.id));
        
        if (memberSelectedRoles.size >= maxRoles) {
          return Err(`You can only have a max of ${maxRoles} roles from this menu. You will need to remove one of your roles before you can add another.`);
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
              return Err("This role no longer exists - please notify the server moderators.");
            }
            if (err.code === RESTJSONErrorCodes.MissingPermissions) {
              return Err("I don't have permission to add this role to you - please notify the server moderators.");
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
      this.logger.error({ err: error, userId: member.id, roleId }, "Failed to handle button interaction");
      
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
  ): Promise<Result<{ addedRoles: string[]; removedRoles: string[]; description: string }, string>> {
    this.logger.debug({ 
      userId: member.id, 
      guildId: member.guild.id, 
      selectedRoleIds 
    }, "Handling select menu interaction");

    try {
      // Check required role
      if (requiredRole && !member.roles.cache.has(requiredRole)) {
        return Err(`You need to have the <@&${requiredRole}> role to use this menu.`);
      }

      const selectedRolesSet = new Set(selectedRoleIds);
      const memberCurrentRoles = new Set(member.roles.cache.keys());
      
      const addedRoles: string[] = [];
      const removedRoles: string[] = [];

      // Calculate new role set
      const memberNewRoles = new Set(memberCurrentRoles);

      // Add selected roles
      for (const roleId of selectedRoleIds) {
        if (!memberCurrentRoles.has(roleId)) {
          addedRoles.push(roleId);
        }
        memberNewRoles.add(roleId);
      }

      // Remove unselected menu roles
      for (const menuRole of menuRoles) {
        if (!selectedRolesSet.has(menuRole.roleId) && memberCurrentRoles.has(menuRole.roleId)) {
          memberNewRoles.delete(menuRole.roleId);
          removedRoles.push(menuRole.roleId);
        }
      }

      // Apply role changes
      await member.roles.set(Array.from(memberNewRoles));

      // Generate description
      let description = "";
      if (addedRoles.length > 0) {
        const addedRolesMentions = addedRoles.map(r => `<@&${r}>`).join(", ");
        description += `Added roles ${addedRolesMentions}\n`;
      }
      if (removedRoles.length > 0) {
        const removedRolesMentions = removedRoles.map(r => `<@&${r}>`).join(", ");
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
      this.logger.error({ err: error, userId: member.id, selectedRoleIds }, "Failed to handle select menu interaction");
      
      if (error instanceof DiscordAPIError) {
        return Err(error.message);
      }
      
      throw new Error("Failed to handle select menu interaction", { cause: error });
    }
  }
}