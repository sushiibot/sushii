import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type {
  RoleMenuRole,
  UpdateRoleMenuRoleRequest,
} from "../domain/entities/RoleMenuRole";
import type { RoleMenuRepository } from "../domain/repositories/RoleMenuRepository";
import type { BotPermissionsResult } from "../presentation/views/RoleMenuBuilderConstants";

export class RoleMenuRoleService {
  constructor(
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  validateBotPermissions(
    guild: Guild,
    roleIds: string[],
  ): BotPermissionsResult {
    const botMember = guild.members.me;

    if (!botMember) {
      this.logger.warn(
        { guildId: guild.id },
        "guild.members.me is null when validating role permissions",
      );

      // Bot not in guild - shouldn't happen but handle gracefully
      return {
        canManageRoles: false,
        roleIdsHigherThanBot: [],
      };
    }

    // Check if bot has administrator permission (can manage all roles)
    if (botMember.permissions.has(PermissionFlagsBits.Administrator)) {
      return {
        canManageRoles: true,
        roleIdsHigherThanBot: [],
      };
    }

    // Check if bot has manage roles permission
    const canManageRoles = botMember.permissions.has(
      PermissionFlagsBits.ManageRoles,
    );

    if (!canManageRoles) {
      return {
        canManageRoles: false,
        roleIdsHigherThanBot: [],
      };
    }

    // Check role hierarchy - bot can only manage roles below its highest role
    const botHighestPosition = botMember.roles.highest.position;

    const higherRoleIds = [];

    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);

      if (role && role.position >= botHighestPosition) {
        higherRoleIds.push(roleId);
      }
    }

    return {
      canManageRoles,
      roleIdsHigherThanBot: higherRoleIds,
    };
  }

  async setRoles(
    guildId: string,
    menuName: string,
    roleIds: string[],
    guild: Guild,
    userHighestRolePosition?: number,
  ): Promise<Result<BotPermissionsResult, string>> {
    this.logger.debug({ guildId, menuName, roleIds }, "Setting roles for menu");

    // Check if menu exists (business validation)
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

    // Set roles (infrastructure errors will naturally throw)
    await this.roleMenuRepository.setRoles(guildId, menuName, roleIds);

    // Check bot permissions for the roles
    const permissionWarnings = this.validateBotPermissions(guild, roleIds);

    return Ok(permissionWarnings);
  }

  async getRoles(
    guildId: string,
    menuName: string,
  ): Promise<Result<RoleMenuRole[], string>> {
    this.logger.debug({ guildId, menuName }, "Getting roles for menu");

    // Check if menu exists (business validation)
    const menu = await this.roleMenuRepository.findByName(guildId, menuName);
    if (menu.none) {
      return Err(
        `Menu "${menuName}" doesn't exist. Use \`/rolemenu create menu_name:${menuName}\` to create it first, or check the spelling with \`/rolemenu list\`.`,
      );
    }

    // Get roles (infrastructure errors will naturally throw)
    const roles = await this.roleMenuRepository.findRolesByMenu(
      guildId,
      menuName,
    );
    return Ok(roles);
  }

  async updateRoleOptions(
    request: UpdateRoleMenuRoleRequest,
  ): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Updating role options");

    // Check if menu exists (business validation)
    const menu = await this.roleMenuRepository.findByName(
      request.guildId,
      request.menuName,
    );
    if (menu.none) {
      return Err(`Menu "${request.menuName}" not found.`);
    }

    // Check if role exists in menu (business validation)
    const role = await this.roleMenuRepository.findRole(
      request.guildId,
      request.menuName,
      request.roleId,
    );
    if (role.none) {
      return Err(
        `Role <@&${request.roleId}> not found in menu "${request.menuName}".`,
      );
    }

    // Validate description length (business validation)
    if (request.description && request.description.length > 100) {
      return Err("Description cannot be longer than 100 characters.");
    }

    // Update role (infrastructure errors will naturally throw)
    await this.roleMenuRepository.updateRole(request);
    return Ok(undefined);
  }
}
