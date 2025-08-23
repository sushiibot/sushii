export interface RoleMenuMessage {
  guildId: string;
  menuName: string;
  channelId: string;
  messageId: string;
  createdAt: Date;
  needsUpdate: boolean;
}

export interface CreateRoleMenuMessageRequest {
  guildId: string;
  menuName: string;
  channelId: string;
  messageId: string;
}
