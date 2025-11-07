import { sleep } from "bun";
import type { ButtonInteraction, InteractionResponse } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import { ButtonHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";
import { safeDeleteReply, safeReply } from "@/utils/interactionUtils";

import type { RoleMenuInteractionService } from "../../application/RoleMenuInteractionService";
import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import { parseRoleMenuButtonCustomId } from "../constants/roleMenuCustomIds";
import {
  getRoleMenuMaxRoles,
  getRoleMenuMessageButtonRoles,
  getRoleMenuRequiredRole,
} from "../utils/roleMenuMessageParser";

export class RoleMenuButtonHandler extends ButtonHandler {
  // Updated to handle both new and legacy formats
  customIDMatch = (customId: string) => {
    const parsed = parseRoleMenuButtonCustomId(customId);
    return parsed ? { path: customId, index: 0, params: {} } : false;
  };

  constructor(
    private readonly roleMenuInteractionService: RoleMenuInteractionService,
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const parsedCustomId = parseRoleMenuButtonCustomId(interaction.customId);
    if (!parsedCustomId) {
      throw new Error("No role to add or remove");
    }

    // Single reply variable to ensure we only reply once
    let reply: InteractionResponse | null = null;

    const roleToAddOrRemove = parsedCustomId.roleId;
    let requiredRole: string | undefined;
    let maxRoles: number | undefined;
    let menuRoles: { roleId: string; label: string }[];

    try {
      // Try database-first approach for ID or name format
      if (
        !parsedCustomId.isLegacy &&
        (parsedCustomId.id || parsedCustomId.menuName)
      ) {
        let menuResult;
        let menuName: string | undefined;

        if (parsedCustomId.isShort && parsedCustomId.id) {
          // Use ID-based lookup (preferred)
          menuResult = await this.roleMenuManagementService.getMenuById(
            parsedCustomId.id,
          );
          if (menuResult.ok) {
            menuName = menuResult.val.menuName;
          }
        } else if (parsedCustomId.menuName) {
          // Use name-based lookup (fallback)
          menuResult = await this.roleMenuManagementService.getMenu(
            interaction.guildId,
            parsedCustomId.menuName,
          );
          menuName = parsedCustomId.menuName;
        }

        if (menuResult?.ok && menuName) {
          const menu = menuResult.val;
          requiredRole = menu.requiredRole;
          maxRoles = menu.maxCount;

          // Get roles from database
          const rolesResult = await this.roleMenuRoleService.getRoles(
            interaction.guildId,
            menuName,
          );

          if (rolesResult.ok) {
            menuRoles = rolesResult.val.map((r) => ({
              roleId: r.roleId,
              label:
                interaction.guild.roles.cache.get(r.roleId)?.name || r.roleId,
            }));
          } else {
            // Database error getting roles - fatal error for new messages
            this.logger.error(
              { err: rolesResult.val, menuName: parsedCustomId.menuName },
              "Failed to get menu roles from database",
            );

            throw new Error("Failed to get menu roles from database", {
              cause: rolesResult.val,
            });
          }
        } else {
          // Menu not found or database error
          const errorMsg = menuResult?.val || "Menu not found";
          if (
            typeof errorMsg === "string" &&
            (errorMsg.toLowerCase().includes("not found") ||
              errorMsg.toLowerCase().includes("no menu found"))
          ) {
            // Menu was deleted - show proper message using safe reply
            reply = await safeReply(
              interaction,
              {
                embeds: [
                  new EmbedBuilder()
                    .setColor(Color.Error)
                    .setTitle("Menu no longer exists")
                    .setDescription("This role menu has been deleted.")
                    .toJSON(),
                ],
                flags: MessageFlags.Ephemeral,
              },
              this.logger,
            );

            return;
          } else {
            // Infrastructure error - fatal error for new messages
            this.logger.error(
              {
                err: errorMsg,
                id: parsedCustomId.id,
                menuName: parsedCustomId.menuName,
              },
              "Database error fetching menu",
            );
            throw new Error("Database error fetching menu", {
              cause: errorMsg,
            });
          }
        }
      } else {
        // Legacy format or fallback - parse from embed
        requiredRole =
          getRoleMenuRequiredRole(interaction.message) || undefined;
        maxRoles = getRoleMenuMaxRoles(interaction.message) || undefined;
        menuRoles = getRoleMenuMessageButtonRoles(interaction.message);
      }

      const result =
        await this.roleMenuInteractionService.handleButtonInteraction(
          interaction.member,
          roleToAddOrRemove,
          menuRoles,
          requiredRole,
          maxRoles,
        );

      if (result.err) {
        reply = await safeReply(
          interaction,
          {
            embeds: [
              new EmbedBuilder()
                .setColor(Color.Error)
                .setTitle("Failed to update your roles")
                .setDescription(result.val)
                .toJSON(),
            ],
            flags: MessageFlags.Ephemeral,
          },
          this.logger,
        );

        return;
      }

      const { description } = result.val;

      reply = await safeReply(
        interaction,
        {
          embeds: [
            new EmbedBuilder()
              .setColor(Color.Success)
              .setTitle("Your roles have been updated")
              .setDescription(description)
              .toJSON(),
          ],
          flags: MessageFlags.Ephemeral,
        },
        this.logger,
      );

      // Delete reply after 5 seconds if reply was successful
      if (reply) {
        await sleep(5000);
        await safeDeleteReply(reply, this.logger, {
          interactionId: interaction.id,
          customId: interaction.customId,
        });
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          interactionId: interaction.id,
          customId: interaction.customId,
          guildId: interaction.guildId,
        },
        "Error handling role menu button interaction",
      );

      // Try to reply with a generic error if we haven't replied yet
      if (!reply) {
        await safeReply(
          interaction,
          {
            embeds: [
              new EmbedBuilder()
                .setColor(Color.Error)
                .setTitle("Error")
                .setDescription(
                  "An unexpected error occurred while processing your request.",
                )
                .toJSON(),
            ],
            flags: MessageFlags.Ephemeral,
          },
          this.logger,
        );
      }

      // Re-throw for upstream error handling
      throw error;
    }
  }
}
