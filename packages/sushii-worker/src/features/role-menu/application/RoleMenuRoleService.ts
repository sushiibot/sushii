import type { Guild } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type { RoleMenuRole, UpdateRoleMenuRoleRequest } from "../domain/entities/RoleMenuRole";
import type { RoleMenuRepository } from "../domain/repositories/RoleMenuRepository";

const RE_ROLE = /(?:<@&)?(\d{17,20})>?/g;

export class RoleMenuRoleService {
  constructor(
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  async addRoles(
    guildId: string,
    menuName: string,
    rolesString: string,
    guild: Guild,
    userHighestRolePosition?: number,
  ): Promise<Result<{ addedRoles: string[]; newTotalRoles: string[] }, string>> {
    this.logger.debug({ guildId, menuName, rolesString }, "Adding roles to menu");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      // Parse role IDs from string
      const roleIds = [...rolesString.matchAll(RE_ROLE)].map((match) => match[1]);
      if (roleIds.length === 0) {
        return Err("No valid roles provided.");
      }

      // Validate role hierarchy if user position is provided (not guild owner)
      if (userHighestRolePosition !== undefined) {
        for (const roleId of roleIds) {
          const role = guild.roles.cache.get(roleId);
          if (role && role.position > userHighestRolePosition) {
            return Err("You cannot add roles higher than your highest role.");
          }
        }
      }

      // Get current roles to check limits
      const currentRoles = await this.roleMenuRepository.findRolesByMenu(guildId, menuName);
      const currentRoleIds = currentRoles.map(r => r.roleId);
      
      // Combine and deduplicate
      const newTotalRoles = [...new Set([...currentRoleIds, ...roleIds])];

      // Check Discord's 25 role limit for components
      if (newTotalRoles.length > 25) {
        return Err("Cannot have more than 25 roles in a menu (Discord limitation).");
      }

      await this.roleMenuRepository.addRoles(guildId, menuName, roleIds);

      return Ok({
        addedRoles: roleIds,
        newTotalRoles,
      });
    } catch (error) {
      this.logger.error({ err: error, guildId, menuName, rolesString }, "Failed to add roles to menu");
      throw new Error("Failed to add roles to menu", { cause: error });
    }
  }

  async removeRoles(
    guildId: string,
    menuName: string,
    rolesString: string,
  ): Promise<Result<{ removedRoles: string[]; remainingRoles: string[] }, string>> {
    this.logger.debug({ guildId, menuName, rolesString }, "Removing roles from menu");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      // Parse role IDs from string
      const roleIdsToRemove = [...rolesString.matchAll(RE_ROLE)].map((match) => match[1]);
      if (roleIdsToRemove.length === 0) {
        return Err("No valid roles provided.");
      }

      // Get current roles
      const currentRoles = await this.roleMenuRepository.findRolesByMenu(guildId, menuName);
      const currentRoleIds = currentRoles.map(r => r.roleId);
      
      // Calculate remaining roles
      const remainingRoles = currentRoleIds.filter(id => !roleIdsToRemove.includes(id));

      await this.roleMenuRepository.removeRoles(guildId, menuName, roleIdsToRemove);

      return Ok({
        removedRoles: roleIdsToRemove,
        remainingRoles,
      });
    } catch (error) {
      this.logger.error({ err: error, guildId, menuName, rolesString }, "Failed to remove roles from menu");
      throw new Error("Failed to remove roles from menu", { cause: error });
    }
  }

  async getRoles(guildId: string, menuName: string): Promise<Result<RoleMenuRole[], string>> {
    this.logger.debug({ guildId, menuName }, "Getting roles for menu");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      const roles = await this.roleMenuRepository.findRolesByMenu(guildId, menuName);
      return Ok(roles);
    } catch (error) {
      this.logger.error({ err: error, guildId, menuName }, "Failed to get roles for menu");
      throw new Error("Failed to get roles for menu", { cause: error });
    }
  }

  async updateRoleOptions(request: UpdateRoleMenuRoleRequest): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Updating role options");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(request.guildId, request.menuName);
      if (menu.none) {
        return Err(`Menu "${request.menuName}" not found.`);
      }

      // Check if role exists in menu
      const role = await this.roleMenuRepository.findRole(request.guildId, request.menuName, request.roleId);
      if (role.none) {
        return Err("Role is not in this menu.");
      }

      // Validate description length
      if (request.description && request.description.length > 100) {
        return Err("Description cannot be longer than 100 characters.");
      }

      await this.roleMenuRepository.updateRole(request);
      return Ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, request }, "Failed to update role options");
      throw new Error("Failed to update role options", { cause: error });
    }
  }

  async reorderRoles(
    guildId: string,
    menuName: string,
    rolesString: string,
  ): Promise<Result<{ newOrder: string[]; previousOrder: string[] }, string>> {
    this.logger.debug({ guildId, menuName, rolesString }, "Reordering roles in menu");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      // Parse role IDs from string
      const newOrderRoleIds = [...rolesString.matchAll(RE_ROLE)].map((match) => match[1]);
      if (newOrderRoleIds.length === 0) {
        return Err("No valid roles provided.");
      }

      // Get current roles
      const currentRoles = await this.roleMenuRepository.findRolesByMenu(guildId, menuName);
      const currentRoleIds = currentRoles.map(r => r.roleId);

      // Validate that new order contains exactly the same roles
      const currentRoleIdsSet = new Set(currentRoleIds);
      const newOrderRoleIdsSet = new Set(newOrderRoleIds);

      if (
        currentRoleIdsSet.size !== newOrderRoleIdsSet.size ||
        !currentRoleIds.every(id => newOrderRoleIdsSet.has(id))
      ) {
        return Err(`New order must contain exactly the same roles. Expected: ${currentRoleIds.map(id => `<@&${id}>`).join(", ")}`);
      }

      await this.roleMenuRepository.reorderRoles(guildId, menuName, newOrderRoleIds);

      return Ok({
        newOrder: newOrderRoleIds,
        previousOrder: currentRoleIds,
      });
    } catch (error) {
      this.logger.error({ err: error, guildId, menuName, rolesString }, "Failed to reorder roles");
      throw new Error("Failed to reorder roles", { cause: error });
    }
  }
}