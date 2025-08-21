export interface RoleMenu {
  guildId: string;
  menuName: string;
  description?: string;
  maxCount?: number;
  requiredRole?: string;
}

export interface CreateRoleMenuRequest {
  guildId: string;
  menuName: string;
  description?: string;
  maxCount?: number;
  requiredRole?: string;
}

export interface UpdateRoleMenuRequest {
  guildId: string;
  menuName: string;
  newMenuName?: string;
  description?: string;
  maxCount?: number;
  requiredRole?: string;
}
