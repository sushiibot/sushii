import type { TextChannel } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type {
  CreateRoleMenuMessageRequest,
  RoleMenuMessage,
} from "../domain/entities/RoleMenuMessage";
import type { DrizzleRoleMenuRepository } from "../infrastructure/repositories/DrizzleRoleMenuRepository";

export class RoleMenuMessageService {
  constructor(
    private readonly roleMenuRepository: DrizzleRoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  async trackSentMenu(
    guildId: string,
    menuName: string,
    channelId: string,
    messageId: string,
    componentType: "buttons" | "select_menu",
  ): Promise<Result<void, string>> {
    this.logger.debug(
      { guildId, menuName, channelId, messageId, componentType },
      "Tracking sent role menu",
    );

    // Check if we've hit the limit of 5 active menus (business validation)
    const activeCount = await this.roleMenuRepository.countActiveMessages(
      guildId,
      menuName,
    );

    if (activeCount >= 5) {
      return Err(
        "This menu already has 5 active copies (maximum). Remove an existing one first.",
      );
    }

    // Track message (infrastructure errors will naturally throw)
    const request: CreateRoleMenuMessageRequest = {
      guildId,
      menuName,
      channelId,
      messageId,
      componentType,
    };

    await this.roleMenuRepository.trackMessage(request);
    return Ok(undefined);
  }

  async getActiveMenus(
    guildId: string,
    menuName: string,
  ): Promise<RoleMenuMessage[]> {
    this.logger.debug({ guildId, menuName }, "Getting active menus");

    try {
      return await this.roleMenuRepository.getActiveMessages(guildId, menuName);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to get active menus",
      );
      throw new Error("Failed to get active menus", { cause: error });
    }
  }

  async getActiveMenusWithStatus(guildId: string): Promise<
    Map<
      string,
      {
        count: number;
        needsUpdate: number;
      }
    >
  > {
    this.logger.debug({ guildId }, "Getting active menus with status");

    try {
      // Get all role menus for this guild
      const allMenus = await this.roleMenuRepository.findByGuild(guildId);
      const statusMap = new Map<
        string,
        { count: number; needsUpdate: number }
      >();

      // For each menu, get its active messages
      await Promise.all(
        allMenus.map(async (menu) => {
          const activeMessages =
            await this.roleMenuRepository.getActiveMessages(
              guildId,
              menu.menuName,
            );

          const needsUpdateCount = activeMessages.filter(
            (msg) => msg.needsUpdate,
          ).length;

          statusMap.set(menu.menuName, {
            count: activeMessages.length,
            needsUpdate: needsUpdateCount,
          });
        }),
      );

      return statusMap;
    } catch (error) {
      this.logger.error(
        { err: error, guildId },
        "Failed to get active menus with status",
      );
      throw new Error("Failed to get active menus with status", {
        cause: error,
      });
    }
  }

  async markMenuNeedsUpdate(guildId: string, menuName: string): Promise<void> {
    this.logger.debug({ guildId, menuName }, "Marking menu as needing update");

    try {
      await this.roleMenuRepository.markMessagesNeedUpdate(guildId, menuName);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to mark menu as needing update",
      );
      throw new Error("Failed to mark menu as needing update", {
        cause: error,
      });
    }
  }

  async markMessagesUpdated(guildId: string, menuName: string): Promise<void> {
    this.logger.debug({ guildId, menuName }, "Marking messages as updated");

    try {
      await this.roleMenuRepository.markMessagesUpdated(guildId, menuName);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to mark messages as updated",
      );
      throw new Error("Failed to mark messages as updated", { cause: error });
    }
  }

  async removeActiveMenus(
    guildId: string,
    menuName: string,
    channel: TextChannel,
  ): Promise<Result<number, string>> {
    this.logger.debug({ guildId, menuName }, "Removing active menus");

    try {
      const activeMessages = await this.roleMenuRepository.getActiveMessages(
        guildId,
        menuName,
      );

      if (activeMessages.length === 0) {
        return Ok(0);
      }

      let removedCount = 0;
      const failures: string[] = [];

      // Delete each message
      for (const message of activeMessages) {
        try {
          // Get the channel where this message was sent
          const messageChannel = await channel.guild.channels.fetch(
            message.channelId,
          );

          if (!messageChannel?.isTextBased()) {
            failures.push(
              `Channel ${message.channelId} not found or not text-based`,
            );
            continue;
          }

          // Fetch and delete the message
          const discordMessage = await messageChannel.messages.fetch(
            message.messageId,
          );
          await discordMessage.delete();

          removedCount++;
        } catch (error) {
          this.logger.warn(
            { err: error, messageId: message.messageId },
            "Failed to delete message",
          );
          failures.push(`Message ${message.messageId}: ${String(error)}`);
        }
      }

      // Remove tracking records
      await this.roleMenuRepository.deleteAllMessages(guildId, menuName);

      if (failures.length > 0) {
        return Err(
          `Removed ${removedCount}/${activeMessages.length} menus. Failures: ${failures.join(", ")}`,
        );
      }

      return Ok(removedCount);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to remove active menus",
      );
      return Err("Failed to remove active menus");
    }
  }

  async removeMessage(
    guildId: string,
    menuName: string,
    messageId: string,
  ): Promise<void> {
    this.logger.debug(
      { guildId, menuName, messageId },
      "Removing tracked message",
    );

    try {
      await this.roleMenuRepository.deleteMessage(guildId, menuName, messageId);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName, messageId },
        "Failed to remove tracked message",
      );
      throw new Error("Failed to remove tracked message", { cause: error });
    }
  }
}
