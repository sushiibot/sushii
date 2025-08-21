import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type { CreateRoleMenuRequest, RoleMenu, UpdateRoleMenuRequest } from "../domain/entities/RoleMenu";
import type { RoleMenuRepository } from "../domain/repositories/RoleMenuRepository";

export class RoleMenuManagementService {
  constructor(
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  async createMenu(request: CreateRoleMenuRequest): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Creating role menu");

    try {
      // Check if menu already exists
      const existingMenu = await this.roleMenuRepository.findByName(request.guildId, request.menuName);
      if (existingMenu.some) {
        return Err(`A menu with the name "${request.menuName}" already exists.`);
      }

      await this.roleMenuRepository.create(request);
      return Ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, request }, "Failed to create role menu");
      throw new Error("Failed to create role menu", { cause: error });
    }
  }

  async getMenu(guildId: string, menuName: string): Promise<Result<RoleMenu, string>> {
    this.logger.debug({ guildId, menuName }, "Getting role menu");

    try {
      const menu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (menu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      return Ok(menu.safeUnwrap());
    } catch (error) {
      this.logger.error({ err: error, guildId, menuName }, "Failed to get role menu");
      throw new Error("Failed to get role menu", { cause: error });
    }
  }

  async listMenus(guildId: string): Promise<RoleMenu[]> {
    this.logger.debug({ guildId }, "Listing role menus");

    try {
      return await this.roleMenuRepository.findByGuild(guildId);
    } catch (error) {
      this.logger.error({ err: error, guildId }, "Failed to list role menus");
      throw new Error("Failed to list role menus", { cause: error });
    }
  }

  async searchMenus(guildId: string, query: string): Promise<RoleMenu[]> {
    this.logger.debug({ guildId, query }, "Searching role menus");

    try {
      return await this.roleMenuRepository.search(guildId, query);
    } catch (error) {
      this.logger.error({ err: error, guildId, query }, "Failed to search role menus");
      throw new Error("Failed to search role menus", { cause: error });
    }
  }

  async updateMenu(request: UpdateRoleMenuRequest): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Updating role menu");

    try {
      // Check if menu exists
      const existingMenu = await this.roleMenuRepository.findByName(request.guildId, request.menuName);
      if (existingMenu.none) {
        return Err(`Menu "${request.menuName}" not found.`);
      }

      // If changing name, check that new name doesn't exist
      if (request.newMenuName) {
        const menuWithNewName = await this.roleMenuRepository.findByName(request.guildId, request.newMenuName);
        if (menuWithNewName.some) {
          return Err(`A menu with the name "${request.newMenuName}" already exists.`);
        }
      }

      await this.roleMenuRepository.update(request);
      return Ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, request }, "Failed to update role menu");
      throw new Error("Failed to update role menu", { cause: error });
    }
  }

  async deleteMenu(guildId: string, menuName: string): Promise<Result<void, string>> {
    this.logger.debug({ guildId, menuName }, "Deleting role menu");

    try {
      // Check if menu exists
      const existingMenu = await this.roleMenuRepository.findByName(guildId, menuName);
      if (existingMenu.none) {
        return Err(`Menu "${menuName}" not found.`);
      }

      await this.roleMenuRepository.delete(guildId, menuName);
      return Ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, guildId, menuName }, "Failed to delete role menu");
      throw new Error("Failed to delete role menu", { cause: error });
    }
  }
}