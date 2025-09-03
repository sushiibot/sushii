import type { Guild, TextChannel } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuMessageService } from "../../application/RoleMenuMessageService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import { createRoleMenuMessage } from "../views/RoleMenuView";

export class RoleMenuUpdateService {
  constructor(
    private readonly roleMenuMessageService: RoleMenuMessageService,
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
    private readonly logger: Logger,
  ) {}

  async updateActiveMenus(
    guildId: string,
    menuName: string,
    channel: TextChannel,
    guild: Guild,
  ): Promise<Result<number, string>> {
    this.logger.debug({ guildId, menuName }, "Updating active menus");

    try {
      // Get active messages from the message service
      const activeMessages = await this.roleMenuMessageService.getActiveMenus(
        guildId,
        menuName,
      );

      if (activeMessages.length === 0) {
        return Ok(0);
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

      let updatedCount = 0;
      const failures: string[] = [];

      // Update each message
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
          updatedCount++;
        } catch (error) {
          this.logger.warn(
            { err: error, messageId: message.messageId },
            "Failed to update message",
          );
          failures.push(`Message ${message.messageId}: ${String(error)}`);
        }
      }

      // Clear needs_update flag for all messages
      await this.roleMenuMessageService.markMessagesUpdated(guildId, menuName);

      if (failures.length > 0) {
        return Err(
          `Updated ${updatedCount}/${activeMessages.length} menus. Failures: ${failures.join(", ")}`,
        );
      }

      return Ok(updatedCount);
    } catch (error) {
      this.logger.error(
        { err: error, guildId, menuName },
        "Failed to update active menus",
      );
      return Err("Failed to update active menus");
    }
  }
}
