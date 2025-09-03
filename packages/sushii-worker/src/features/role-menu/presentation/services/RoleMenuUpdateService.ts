import {
  DiscordAPIError,
  type Guild,
  RESTJSONErrorCodes,
  type TextChannel,
} from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import type { RoleMenuRepository } from "../../domain/repositories/RoleMenuRepository";
import { createRoleMenuMessage } from "../views/RoleMenuView";

export interface FailedMenu {
  channelId: string;
  url: string;
  error: string;
}

export interface UpdateActiveMenusResult {
  updatedMenuURLs: string[];
  failed: FailedMenu[];
  noUpdateNeeded: string[];
}

export class RoleMenuUpdateService {
  constructor(
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly logger: Logger,
  ) {}

  async updateActiveMenus(
    guildId: string,
    menuName: string,
    channel: TextChannel,
    guild: Guild,
  ): Promise<Result<UpdateActiveMenusResult, string>> {
    this.logger.debug({ guildId, menuName }, "Updating active menus");

    try {
      // Get active messages from the repository
      const activeMessages = await this.roleMenuRepository.getActiveMessages(
        guildId,
        menuName,
      );

      if (activeMessages.length === 0) {
        return Ok({
          updatedMenuURLs: [],
          failed: [],
          noUpdateNeeded: [],
        });
      }

      // Get menu data once (shared for all messages)
      const menuResult = await this.roleMenuManagementService.getMenu(
        guildId,
        menuName,
      );
      if (menuResult.err) {
        return Err(menuResult.val);
      }

      const rolesResult = await this.roleMenuRoleService.getRoles(
        guildId,
        menuName,
      );
      if (rolesResult.err) {
        return Err(rolesResult.val);
      }

      const menu = menuResult.val;
      const roles = rolesResult.val;

      if (roles.length === 0) {
        return Err("This menu has no roles configured.");
      }

      const updatedMenuURLs: string[] = [];
      const failed: FailedMenu[] = [];

      // Update each message
      for (const message of activeMessages) {
        const messageUrl = `https://discord.com/channels/${guildId}/${message.channelId}/${message.messageId}`;

        try {
          // Get the channel where this message was sent
          const messageChannel = await channel.guild.channels.fetch(
            message.channelId,
          );

          if (!messageChannel?.isTextBased()) {
            failed.push({
              channelId: message.channelId,
              url: messageUrl,
              error: "Channel not found or not text-based",
            });
            continue;
          }

          // Fetch the existing message
          const discordMessage = await messageChannel.messages.fetch(
            message.messageId,
          );

          // Use the stored component type from the database
          const messageType = message.componentType;

          // Render content for this specific message type
          const menuContent = createRoleMenuMessage({
            menu,
            roles,
            guild,
            type: messageType,
          });

          await discordMessage.edit({
            embeds: [menuContent.embed.toJSON()],
            components: menuContent.components.map((c) => c.toJSON()),
          });

          updatedMenuURLs.push(messageUrl);
        } catch (error) {
          if (
            error instanceof DiscordAPIError &&
            error.code === RESTJSONErrorCodes.UnknownMessage
          ) {
            // Message was deleted by user, clean up the database entry silently
            try {
              await this.roleMenuRepository.deleteMessage(
                guildId,
                menuName,
                message.messageId,
              );
            } catch (deleteError) {
              this.logger.warn(
                { err: deleteError, messageId: message.messageId },
                "Failed to delete orphaned message record",
              );
            }

            continue;
          }

          this.logger.warn(
            { err: error, messageId: message.messageId },
            "Failed to update message",
          );

          failed.push({
            channelId: message.channelId,
            url: messageUrl,
            error: String(error),
          });
        }
      }

      // Clear needs_update flag for all messages
      await this.roleMenuRepository.markMessagesUpdated(guildId, menuName);

      return Ok({
        updatedMenuURLs,
        failed,
        noUpdateNeeded: [],
      });
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to update active menus",
      );
      return Err("Failed to update active menus");
    }
  }
}
