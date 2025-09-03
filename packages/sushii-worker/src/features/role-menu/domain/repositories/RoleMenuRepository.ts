import type { Option } from "ts-results";

import type {
  CreateRoleMenuRequest,
  RoleMenu,
  UpdateRoleMenuRequest,
} from "../entities/RoleMenu";
import type {
  CreateRoleMenuMessageRequest,
  RoleMenuMessage,
} from "../entities/RoleMenuMessage";
import type {
  RoleMenuRole,
  UpdateRoleMenuRoleRequest,
} from "../entities/RoleMenuRole";

export interface RoleMenuRepository {
  // Role Menu CRUD operations
  create(request: CreateRoleMenuRequest): Promise<void>;
  findById(id: number): Promise<Option<RoleMenu>>;
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

  // Role Menu Message tracking operations
  trackMessage(request: CreateRoleMenuMessageRequest): Promise<void>;
  getActiveMessages(
    guildId: string,
    menuName: string,
  ): Promise<RoleMenuMessage[]>;
  countActiveMessages(guildId: string, menuName: string): Promise<number>;
  markMessagesNeedUpdate(guildId: string, menuName: string): Promise<void>;
  markMessagesUpdated(guildId: string, menuName: string): Promise<void>;
  deleteMessage(
    guildId: string,
    menuName: string,
    messageId: string,
  ): Promise<void>;
  deleteAllMessages(guildId: string, menuName: string): Promise<void>;
}
