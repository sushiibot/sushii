import type { Insertable, Selectable, Updateable } from "kysely";
import type {
  AppPublicRoleMenuRoles,
  AppPublicRoleMenus,
} from "../../infrastructure/database/dbTypes";

export type RoleMenuRow = Selectable<AppPublicRoleMenus>;
export type InsertableRoleMenuRow = Insertable<AppPublicRoleMenus>;
export type UpdateableRoleMenuRow = Updateable<AppPublicRoleMenus>;

export type RoleMenuRoleRow = Selectable<AppPublicRoleMenuRoles>;
export type InsertableRoleMenuRoleRow = Insertable<AppPublicRoleMenuRoles>;
export type UpdateableRoleMenuRoleRow = Updateable<AppPublicRoleMenuRoles>;
