import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type {
  CreateRoleMenuRequest,
  RoleMenu,
  UpdateRoleMenuRequest,
} from "../domain/entities/RoleMenu";
import type { RoleMenuRepository } from "../domain/repositories/RoleMenuRepository";

export class RoleMenuManagementService {
  constructor(
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  async createMenu(
    request: CreateRoleMenuRequest,
  ): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Creating role menu");

    // Check if menu already exists (business validation)
    const existingMenu = await this.roleMenuRepository.findByName(
      request.guildId,
      request.menuName,
    );
    if (existingMenu.some) {
      return Err(`A menu with the name "${request.menuName}" already exists.`);
    }

    // Create menu (infrastructure errors will naturally throw)
    await this.roleMenuRepository.create(request);
    return Ok(undefined);
  }

  async getMenu(
    guildId: string,
    menuName: string,
  ): Promise<Result<RoleMenu, string>> {
    this.logger.debug({ guildId, menuName }, "Getting role menu");

    // Check if menu exists (business validation)
    const menu = await this.roleMenuRepository.findByName(guildId, menuName);
    if (menu.none) {
      return Err(`Menu "${menuName}" not found.`);
    }

    // Return menu (infrastructure errors will naturally throw)
    return Ok(menu.safeUnwrap());
  }

  async listMenus(guildId: string): Promise<RoleMenu[]> {
    this.logger.debug({ guildId }, "Listing role menus");

    // Infrastructure operation - errors will naturally throw
    return await this.roleMenuRepository.findByGuild(guildId);
  }

  async searchMenus(guildId: string, query: string): Promise<RoleMenu[]> {
    this.logger.debug({ guildId, query }, "Searching role menus");

    // Infrastructure operation - errors will naturally throw
    return await this.roleMenuRepository.search(guildId, query);
  }

  async updateMenu(
    request: UpdateRoleMenuRequest,
  ): Promise<Result<void, string>> {
    this.logger.debug({ request }, "Updating role menu");

    // Check if menu exists (business validation)
    const existingMenu = await this.roleMenuRepository.findByName(
      request.guildId,
      request.menuName,
    );
    if (existingMenu.none) {
      return Err(`Menu "${request.menuName}" not found.`);
    }

    // If changing name, check that new name doesn't exist (business validation)
    if (request.newMenuName) {
      const menuWithNewName = await this.roleMenuRepository.findByName(
        request.guildId,
        request.newMenuName,
      );
      if (menuWithNewName.some) {
        return Err(
          `A menu with the name "${request.newMenuName}" already exists.`,
        );
      }
    }

    // Update menu (infrastructure errors will naturally throw)
    await this.roleMenuRepository.update(request);
    return Ok(undefined);
  }

  async deleteMenu(
    guildId: string,
    menuName: string,
  ): Promise<Result<void, string>> {
    this.logger.debug({ guildId, menuName }, "Deleting role menu");

    // Check if menu exists (business validation)
    const existingMenu = await this.roleMenuRepository.findByName(
      guildId,
      menuName,
    );
    if (existingMenu.none) {
      return Err(`Menu "${menuName}" not found.`);
    }

    // Delete menu (infrastructure errors will naturally throw)
    await this.roleMenuRepository.delete(guildId, menuName);
    return Ok(undefined);
  }
}
