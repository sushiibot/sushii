import type { Notification } from "../entities/Notification";

export interface NotificationRepository {
  add(notification: Notification): Promise<boolean>;
  findByUserAndGuild(guildId: string, userId: string): Promise<Notification[]>;
  findByUserGuildAndKeyword(
    guildId: string,
    userId: string,
    keyword: string,
  ): Promise<Notification | null>;
  searchByUserAndGuild(
    guildId: string,
    userId: string,
    query: string,
  ): Promise<Notification[]>;
  delete(guildId: string, userId: string, keyword: string): Promise<boolean>;
  deleteByUser(guildId: string, userId: string): Promise<void>;
  findMatchingNotifications(
    guildId: string,
    channelCategoryId: string | null,
    channelId: string,
    authorId: string,
    messageContent: string,
  ): Promise<Notification[]>;
  getTotalCount(): Promise<number>;
}
