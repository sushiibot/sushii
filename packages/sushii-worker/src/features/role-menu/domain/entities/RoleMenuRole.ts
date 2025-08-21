export interface RoleMenuRole {
  guildId: string;
  menuName: string;
  roleId: string;
  emoji?: string;
  description?: string;
  position?: number;
}

export interface CreateRoleMenuRoleRequest {
  guildId: string;
  menuName: string;
  roleId: string;
  emoji?: string;
  description?: string;
}

export interface UpdateRoleMenuRoleRequest {
  guildId: string;
  menuName: string;
  roleId: string;
  emoji?: string;
  description?: string;
}
