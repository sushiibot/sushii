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
        return Err(
          `Menu "${menuName}" doesn't exist. Use \`/rolemenu create menu_name:${menuName}\` to create it first, or check the spelling with \`/rolemenu list\`.`,
        );
      }

      // Validate role hierarchy if user position is provided (not guild owner)
      if (userHighestRolePosition !== undefined) {
        for (const roleId of roleIds) {
          const role = guild.roles.cache.get(roleId);

          if (role && role.position > userHighestRolePosition) {
            return Err(
              `Cannot add role <@&${roleId}> - it's higher than your highest role. Ask someone with a higher role to add it, or lower the role's position in Server Settings.`,
            );
          }
        }
      }

      // Check Discord's 25 role limit for components
      if (roleIds.length > 25) {
        return Err(
          `Discord limits menus to 25 roles (you're trying to add ${roleIds.length}). Consider: 1) Creating multiple menus, or 2) Removing unused roles.`,
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
        return Err(
          `Menu "${menuName}" doesn't exist. Use \`/rolemenu create menu_name:${menuName}\` to create it first, or check the spelling with \`/rolemenu list\`.`,
        );
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
        // Also shouldn't happen because of user
        return Err(`Menu "${request.menuName}" not found.`);
      }

      // Check if role exists in menu
      const role = await this.roleMenuRepository.findRole(
        request.guildId,
        request.menuName,
        request.roleId,
      );
      if (role.none) {
        // Not a user facing error
        throw new Error(
          `Role "${request.roleId}" not found in menu "${request.menuName}".`,
        );
      }

      if (request.description && request.description.length > 100) {
        // Description length is capped by modal input field, so this should
        // not happen.
        throw new Error("Description cannot be longer than 100 characters.");
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
