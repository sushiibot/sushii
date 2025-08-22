import type { Option } from "ts-results";

import type {
  CreateRoleMenuRequest,
  RoleMenu,
  UpdateRoleMenuRequest,
} from "../entities/RoleMenu";
import type {
  RoleMenuRole,
  UpdateRoleMenuRoleRequest,
} from "../entities/RoleMenuRole";

export interface RoleMenuRepository {
  // Role Menu CRUD operations
  create(request: CreateRoleMenuRequest): Promise<void>;
  findByName(guildId: string, menuName: string): Promise<Option<RoleMenu>>;
  findByGuild(guildId: string): Promise<RoleMenu[]>;
  search(guildId: string, query: string): Promise<RoleMenu[]>;
  update(request: UpdateRoleMenuRequest): Promise<void>;
  delete(guildId: string, menuName: string): Promise<void>;

  // Role Menu Role operations
  setRoles(guildId: string, menuName: string, roleIds: string[]): Promise<void>;
  findRolesByMenu(guildId: string, menuName: string): Promise<RoleMenuRole[]>;
  findRole(
    guildId: string,
    menuName: string,
    roleId: string,
  ): Promise<Option<RoleMenuRole>>;
  updateRole(request: UpdateRoleMenuRoleRequest): Promise<void>;
}
