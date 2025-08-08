import type { Logger } from "pino";

import { Notification } from "../domain/entities/Notification";
import { NotificationBlock } from "../domain/entities/NotificationBlock";
import type { NotificationBlockRepository } from "../domain/repositories/NotificationBlockRepository";
import type { NotificationRepository } from "../domain/repositories/NotificationRepository";

export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly blockRepository: NotificationBlockRepository,
    private readonly logger: Logger,
  ) {}

  async addNotification(
    guildId: string,
    userId: string,
    keyword: string,
  ): Promise<{ success: boolean; alreadyExists: boolean }> {
    try {
      const notification = Notification.create(guildId, userId, keyword);
      const added = await this.notificationRepository.add(notification);

      this.logger.debug({ guildId, userId, keyword }, "Adding notification");

      return {
        success: added,
        alreadyExists: !added,
      };
    } catch (err) {
      this.logger.error(
        { err, guildId, userId, keyword },
        "Failed to add notification",
      );
      throw new Error("Failed to add notification", { cause: err });
    }
  }

  async listNotifications(
    guildId: string,
    userId: string,
  ): Promise<Notification[]> {
    return this.notificationRepository.findByUserAndGuild(guildId, userId);
  }

  async searchNotifications(
    guildId: string,
    userId: string,
    query: string,
  ): Promise<Notification[]> {
    return this.notificationRepository.searchByUserAndGuild(
      guildId,
      userId,
      query,
    );
  }

  async deleteNotification(
    guildId: string,
    userId: string,
    keyword: string,
  ): Promise<boolean> {
    const deleted = await this.notificationRepository.delete(
      guildId,
      userId,
      keyword,
    );

    if (deleted) {
      this.logger.debug({ guildId, userId, keyword }, "Deleted notification");
    }

    return deleted;
  }

  async blockUser(
    userId: string,
    blockedUserId: string,
  ): Promise<{ success: boolean; alreadyExists: boolean }> {
    const block = NotificationBlock.createUserBlock(userId, blockedUserId);
    const added = await this.blockRepository.add(block);

    this.logger.debug(
      { userId, blockedUserId },
      "Blocking user from notifications",
    );

    return {
      success: added,
      alreadyExists: !added,
    };
  }

  async blockChannel(
    userId: string,
    channelId: string,
    blockType: "channel" | "category",
  ): Promise<{ success: boolean; alreadyExists: boolean }> {
    const block =
      blockType === "category"
        ? NotificationBlock.createCategoryBlock(userId, channelId)
        : NotificationBlock.createChannelBlock(userId, channelId);

    const added = await this.blockRepository.add(block);

    this.logger.debug(
      { userId, channelId, blockType },
      "Blocking channel from notifications",
    );

    return {
      success: added,
      alreadyExists: !added,
    };
  }

  async listBlocks(userId: string): Promise<NotificationBlock[]> {
    return this.blockRepository.findByUser(userId);
  }

  async unblock(
    userId: string,
    blockId: string,
  ): Promise<NotificationBlock | null> {
    const unblocked = await this.blockRepository.delete(userId, blockId);

    if (unblocked) {
      this.logger.debug({ userId, blockId }, "Unblocked notifications");
    }

    return unblocked;
  }

  async findMatchingNotifications(
    guildId: string,
    channelCategoryId: string | null,
    channelId: string,
    authorId: string,
    messageContent: string,
  ): Promise<Notification[]> {
    return this.notificationRepository.findMatchingNotifications(
      guildId,
      channelCategoryId,
      channelId,
      authorId,
      messageContent,
    );
  }

  async getTotalNotificationCount(): Promise<number> {
    return this.notificationRepository.getTotalCount();
  }

  async cleanupMemberLeft(guildId: string, userId: string): Promise<void> {
    await this.notificationRepository.deleteByUser(guildId, userId);
    this.logger.debug(
      { guildId, userId },
      "Cleaned up notifications for member who left",
    );
  }
}
