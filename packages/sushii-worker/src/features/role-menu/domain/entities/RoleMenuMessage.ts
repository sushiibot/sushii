export interface RoleMenuMessage {
  guildId: string;
  menuName: string;
  channelId: string;
  messageId: string;
  createdAt: Date;
  needsUpdate: boolean;
  componentType: "buttons" | "select_menu";
}

export interface CreateRoleMenuMessageRequest {
  guildId: string;
  menuName: string;
  channelId: string;
  messageId: string;
  componentType: "buttons" | "select_menu";
}
