import type { Guild } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type {
  RoleMenuRole,
  UpdateRoleMenuRoleRequest,
} from "../domain/entities/RoleMenuRole";
import type { RoleMenuRepository } from "../domain/repositories/RoleMenuRepository";

export class RoleMenuRoleService {
  constructor(
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  async setRoles(
    guildId: string,
    menuName: string,
    roleIds: string[],
    guild: Guild,
    userHighestRolePosition?: number,
  ): Promise<Result<void, string>> {
    this.logger.debug({ guildId, menuName, roleIds }, "Setting roles for menu");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
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

      // Check Discord's 25 role limit for components
      if (roleIds.length > 25) {
        return Err(
          "Cannot have more than 25 roles in a menu (Discord limitation).",
        );
      }

      await this.roleMenuRepository.setRoles(guildId, menuName, roleIds);

      return Ok(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName, roleIds },
        "Failed to set roles for menu",
      );
      throw new Error("Failed to set roles for menu", { cause: error });
    }
  }


  async getRoles(
    guildId: string,
    menuName: string,
  ): Promise<Result<RoleMenuRole[], string>> {
    this.logger.debug({ guildId, menuName }, "Getting roles for menu");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      const roles = await this.roleMenuRepository.findRolesByMenu(
        guildId,
        menuName,
      );
      return Ok(roles);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to get roles for menu",
      );
      throw new Error("Failed to get roles for menu", { cause: error });
    }
  }

  async updateRoleOptions(
    request: UpdateRoleMenuRoleRequest,
  ): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Updating role options");

    try {
      // Check if menu exists
      const menu = await this.roleMenuRepository.findByName(
        request.guildId,
        request.menuName,
      );
      if (menu.none) {
        return Err(`Menu "${request.menuName}" not found.`);
      }

      // Check if role exists in menu
      const role = await this.roleMenuRepository.findRole(
        request.guildId,
        request.menuName,
        request.roleId,
      );
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
      this.logger.error(
        { err: error, request },
        "Failed to update role options",
      );
      throw new Error("Failed to update role options", { cause: error });
    }
  }
}
