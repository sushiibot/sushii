import { sleep } from "bun";
import type {
  APIEmbed,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Guild,
  JSONEncodable,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  ModalMessageModalSubmitInteraction,
  Role,
  RoleSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import Color from "@/utils/colors";
import parseEmoji from "@/utils/parseEmoji";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuMessageService } from "../../application/RoleMenuMessageService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import type { RoleMenu } from "../../domain/entities/RoleMenu";
import type { RoleMenuRole } from "../../domain/entities/RoleMenuRole";
import { roleMenuCustomIds } from "../constants/roleMenuCustomIds";
import {
  ROLE_MENU_BUILDER_CUSTOM_IDS,
  ROLE_MENU_BUILDER_INPUTS,
  ROLE_MENU_BUILDER_MODALS,
} from "../views/RoleMenuBuilderConstants";
import { createRoleMenuBuilderMessage } from "../views/RoleMenuBuilderView";

enum RoleMenuOption {
  Name = "menu_name",
}

interface RoleMenuEditSession {
  userId: string;
  userName: string;
  interactionId: string;
  channelId: string;
  messageId: string;
  startTime: Date;
}

export class RoleMenuCreateCommand {
  private static readonly SESSION_TIMEOUT_MS = 300000; // 5 minutes
  private readonly activeSessions = new Map<string, RoleMenuEditSession>();

  constructor(
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
    private readonly roleMenuMessageService: RoleMenuMessageService,
    private readonly logger: Logger,
  ) {}

  private async getMenuData(
    guildId: string,
    menuName: string,
  ): Promise<Result<{ menu: RoleMenu; roles: RoleMenuRole[] }, string>> {
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

    return Ok({
      menu: menuResult.val,
      roles: rolesResult.val,
    });
  }

  private async validateSession(
    interaction: ChatInputCommandInteraction<"cached">,
    menuName: string,
  ): Promise<boolean> {
    const sessionKey = `${interaction.guildId}:${menuName}`;
    const existingSession = this.activeSessions.get(sessionKey);

    if (!existingSession) {
      return true; // No existing session, can proceed
    }

    // Check if session is stale (>5 minutes old)
    const sessionAge = Date.now() - existingSession.startTime.getTime();
    if (sessionAge > RoleMenuCreateCommand.SESSION_TIMEOUT_MS) {
      // Clean up stale session
      this.activeSessions.delete(sessionKey);
      this.logger.debug(
        { sessionKey, sessionAge },
        "Cleaned up stale session during validation",
      );
      return true;
    }

    if (existingSession.userId === interaction.user.id) {
      // Same user - direct them to existing session with friendly message
      const messageLink = `https://discord.com/channels/${interaction.guildId}/${existingSession.channelId}/${existingSession.messageId}`;
      await interaction.reply({
        content: `You're already editing **${menuName}** here: ${messageLink}\n\nPlease use that one instead!`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    // Different user - block access with friendly message
    const messageLink = `https://discord.com/channels/${interaction.guildId}/${existingSession.channelId}/${existingSession.messageId}`;
    await interaction.reply({
      content: `**${existingSession.userName}** is currently editing **${menuName}**.\n\nYou can view their progress here: ${messageLink}\n\nPlease wait for them to finish or try again in a few minutes.`,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  async handle(
    interaction: ChatInputCommandInteraction<"cached">,
    isEdit: boolean,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name, true);
    const sessionKey = `${interaction.guildId}:${menuName}`;

    // Clean up any stale sessions before proceeding
    this.cleanupStaleSessions();

    // Validate session before proceeding
    const canProceed = await this.validateSession(interaction, menuName);
    if (!canProceed) {
      return;
    }

    try {
      // For create mode, create or get existing menu
      // For edit mode, just get the existing menu
      if (!isEdit) {
        await this.roleMenuManagementService.createMenu({
          guildId: interaction.guildId,
          menuName,
        });
      }

      // Get menu and roles data
      const menuDataResult = await this.getMenuData(
        interaction.guildId,
        menuName,
      );
      if (menuDataResult.err) {
        await interaction.reply({
          content: menuDataResult.val,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const { menu, roles } = menuDataResult.val;

      // Check bot permissions for current roles
      const roleIds = roles.map((role) => role.roleId);
      const permissionWarnings =
        this.roleMenuRoleService.validateBotPermissions(
          interaction.guild,
          roleIds,
        );

      // Create initial builder message
      const builderMessage = createRoleMenuBuilderMessage({
        menu,
        roles,
        guild: interaction.guild,
        state: {
          guildId: interaction.guildId,
          menuName,
          disabled: false,
          expired: false,
          isEdit,
          permissionWarnings,
        },
      });

      const msg = await interaction.reply(builderMessage);

      // Register the session
      this.activeSessions.set(sessionKey, {
        userId: interaction.user.id,
        userName: interaction.user.username,
        interactionId: interaction.id,
        channelId: interaction.channelId,
        messageId: msg.id,
        startTime: new Date(),
      });

      // Create component collector with session timeout
      const collector = msg.createMessageComponentCollector({
        idle: RoleMenuCreateCommand.SESSION_TIMEOUT_MS,
        dispose: true,
      });

      collector.on("collect", async (i) => {
        try {
          this.logger.debug(
            {
              interactionId: i.id,
              customId: i.customId,
              userId: i.user.id,
              guildId: interaction.guildId,
            },
            "Handling role menu builder interaction",
          );

          // Validate user
          if (i.user.id !== interaction.user.id) {
            await i.reply({
              content: "These controls aren't for you!",
              flags: MessageFlags.Ephemeral,
            });
            await sleep(2500);
            return;
          }

          await this.handleBuilderComponentInteraction(i, menuName, isEdit);
        } catch (err) {
          this.logger.error(
            err,
            "Failed to handle role menu builder interaction",
          );
        }
      });

      collector.on("end", async () => {
        try {
          // Get current state
          const menuDataResult = await this.getMenuData(
            interaction.guildId,
            menuName,
          );
          if (menuDataResult.err) {
            // Menu was deleted while editing - show a simple disabled message
            await interaction.editReply({
              content:
                "⏰ **Menu builder session expired**\nThis menu may have been deleted or is no longer accessible.",
              embeds: [],
              components: [],
            });
            return;
          }
          const { menu: currentMenu, roles: currentRoles } = menuDataResult.val;

          // Create disabled message with expiration notice
          const disabledMessage = createRoleMenuBuilderMessage({
            menu: currentMenu,
            roles: currentRoles,
            guild: interaction.guild,
            state: {
              guildId: interaction.guildId,
              menuName,
              disabled: true,
              expired: true,
              isEdit,
            },
          });

          await msg.edit(disabledMessage);
        } catch (err) {
          this.logger.error(
            err,
            "Failed to disable role menu builder components",
          );
        } finally {
          // Always cleanup session when collector ends
          this.activeSessions.delete(sessionKey);
          this.logger.debug(
            { sessionKey, userId: interaction.user.id },
            "Role menu editing session ended",
          );
        }
      });
    } catch (error) {
      // Clean up session if setup fails
      this.activeSessions.delete(sessionKey);
      throw error;
    }
  }

  private async handleBuilderComponentInteraction(
    interaction: MessageComponentInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    if (interaction.isButton()) {
      return this.handleBuilderButtonInteraction(interaction, menuName, isEdit);
    }

    if (interaction.isRoleSelectMenu()) {
      return this.handleBuilderRoleSelectInteraction(
        interaction,
        menuName,
        isEdit,
      );
    }
  }

  private async handleBuilderButtonInteraction(
    interaction: ButtonInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    switch (interaction.customId) {
      case ROLE_MENU_BUILDER_CUSTOM_IDS.EDIT_DESCRIPTION:
        return this.handleEditDescriptionButton(interaction, menuName, isEdit);
      case ROLE_MENU_BUILDER_CUSTOM_IDS.SET_MAX_ROLES:
        return this.handleSetMaxRolesButton(interaction, menuName, isEdit);
      case ROLE_MENU_BUILDER_CUSTOM_IDS.FINISH_AND_UPDATE:
        return this.handleFinishAndUpdateButton(interaction, menuName, isEdit);
      default:
        // Handle role edit buttons (format: edit_role_options:roleId)
        if (
          interaction.customId.startsWith(
            ROLE_MENU_BUILDER_CUSTOM_IDS.EDIT_ROLE_OPTIONS,
          )
        ) {
          const roleId = interaction.customId.split(":")[1];
          return this.handleEditRoleOptionsButton(
            interaction,
            menuName,
            roleId,
            isEdit,
          );
        }
        throw new Error("Unknown button custom ID");
    }
  }

  private async handleBuilderRoleSelectInteraction(
    interaction: RoleSelectMenuInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    switch (interaction.customId) {
      case ROLE_MENU_BUILDER_CUSTOM_IDS.ROLE_SELECT:
        return this.handleRoleSelectMenu(interaction, menuName, isEdit);
      case ROLE_MENU_BUILDER_CUSTOM_IDS.REQUIRED_ROLE_SELECT:
        return this.handleRequiredRoleSelectMenu(interaction, menuName, isEdit);
      default:
        throw new Error("Unknown role select custom ID");
    }
  }

  private async handleEditDescriptionButton(
    interaction: ButtonInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    // Get current description
    const menuDataResult = await this.getMenuData(
      interaction.guildId,
      menuName,
    );
    if (menuDataResult.err) {
      await interaction.reply({
        content: menuDataResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const currentDescription = menuDataResult.val.menu.description || "";

    // Create modal
    const modal = new ModalBuilder()
      .setCustomId(ROLE_MENU_BUILDER_MODALS.DESCRIPTION)
      .setTitle("Edit Menu Description");

    const descriptionInput = new TextInputBuilder()
      .setCustomId(ROLE_MENU_BUILDER_INPUTS.DESCRIPTION)
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setValue(currentDescription)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    );

    await interaction.showModal(modal);

    try {
      const modalSubmission = await interaction.awaitModalSubmit({
        time: 120000, // 2 minutes
      });

      if (!modalSubmission.isFromMessage()) {
        throw new Error("Modal submission is not from a message interaction");
      }

      const newDescription = modalSubmission.fields.getTextInputValue(
        ROLE_MENU_BUILDER_INPUTS.DESCRIPTION,
      );

      // Update menu
      await this.roleMenuManagementService.updateMenu({
        guildId: interaction.guildId,
        menuName,
        description: newDescription || undefined,
      });

      await this.refreshBuilderMessage(modalSubmission, menuName, isEdit);
    } catch (err) {
      this.logger.debug(
        { interactionId: interaction.id, err },
        "Description modal submission timed out or failed",
      );
    }
  }

  private async handleSetMaxRolesButton(
    interaction: ButtonInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    // Get current max roles
    const menuDataResult = await this.getMenuData(
      interaction.guildId,
      menuName,
    );
    if (menuDataResult.err) {
      await interaction.reply({
        content: menuDataResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const currentMaxRoles = menuDataResult.val.menu.maxCount?.toString() || "";

    // Create modal
    const modal = new ModalBuilder()
      .setCustomId(ROLE_MENU_BUILDER_MODALS.MAX_ROLES)
      .setTitle("Set Maximum Roles");

    const maxRolesInput = new TextInputBuilder()
      .setCustomId(ROLE_MENU_BUILDER_INPUTS.MAX_ROLES)
      .setLabel("Max roles")
      .setPlaceholder("A number 1-25, leave empty for no limit")
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2)
      .setValue(currentMaxRoles)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(maxRolesInput),
    );

    await interaction.showModal(modal);

    try {
      const modalSubmission = await interaction.awaitModalSubmit({
        time: 120000, // 2 minutes
      });

      if (!modalSubmission.isFromMessage()) {
        throw new Error("Modal submission is not from a message interaction");
      }

      const maxRolesStr = modalSubmission.fields.getTextInputValue(
        ROLE_MENU_BUILDER_INPUTS.MAX_ROLES,
      );

      let maxRoles: number | undefined;
      if (maxRolesStr) {
        const parsed = parseInt(maxRolesStr, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 25) {
          await modalSubmission.reply({
            content: `Invalid max roles value "${maxRolesStr}". Please enter a number between 1 and 25.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        maxRoles = parsed;
      }

      // Update menu
      await this.roleMenuManagementService.updateMenu({
        guildId: interaction.guildId,
        menuName,
        maxCount: maxRoles,
      });

      await this.refreshBuilderMessage(modalSubmission, menuName, isEdit);
    } catch (err) {
      this.logger.debug(
        { interactionId: interaction.id, err },
        "Max roles modal submission timed out or failed",
      );
    }
  }

  private async handleFinishAndUpdateButton(
    interaction: ButtonInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    // Get active messages for this menu
    const activeMessages = await this.roleMenuMessageService.getActiveMenus(
      interaction.guildId,
      menuName,
    );

    if (activeMessages.length === 0) {
      await interaction.reply({
        content: "No active menus to update!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer the reply as updating can take time
    await interaction.deferReply({ ephemeral: true });

    // Get current menu data to build the message content
    // const { menu, roles } = await this.getMenuData(interaction.guildId, menuName);

    // Build the new message content (same logic as in RoleMenuCommand.sendHandler)
    // For now, we'll delegate to the service to handle the actual updating
    if (!interaction.channel?.isTextBased()) {
      await interaction.editReply({
        content: "This command must be used in a text channel.",
      });
      return;
    }

    // Build the updated menu content for both button and select menu formats
    const menuContent = await this.buildMenuContent(
      interaction.guildId,
      menuName,
      interaction.guild,
    );

    if (menuContent.err) {
      await interaction.editReply({
        content: `Failed to build menu content: ${menuContent.val}`,
      });
      return;
    }

    const updateResult = await this.roleMenuMessageService.updateActiveMenus(
      interaction.guildId,
      menuName,
      interaction.channel as TextChannel,
      menuContent.val,
    );

    if (updateResult.err) {
      await interaction.editReply({
        content: `Failed to update active menus: ${updateResult.val}`,
      });
      return;
    }

    // End the editing session
    const sessionKey = `${interaction.guildId}:${menuName}`;
    this.activeSessions.delete(sessionKey);

    // Disable the builder components
    const menuDataResult = await this.getMenuData(
      interaction.guildId,
      menuName,
    );
    if (menuDataResult.err) {
      // Menu was deleted during editing - show simple completion message
      await interaction.editReply({
        content:
          "✅ **Menu update completed**\nThe menu may have been deleted during editing.",
        embeds: [],
        components: [],
      });
      return;
    }
    const { menu: currentMenu, roles: currentRoles } = menuDataResult.val;

    const disabledMessage = createRoleMenuBuilderMessage({
      menu: currentMenu,
      roles: currentRoles,
      guild: interaction.guild,
      state: {
        guildId: interaction.guildId,
        menuName,
        disabled: true,
        expired: true,
        isEdit,
      },
    });

    await interaction.message.edit(disabledMessage);

    await interaction.editReply({
      content: `✅ Updated ${updateResult.val} active menus successfully!`,
    });
  }

  private async handleEditRoleOptionsButton(
    interaction: ButtonInteraction<"cached">,
    menuName: string,
    roleId: string,
    isEdit: boolean,
  ): Promise<void> {
    // Get current role options
    const menuDataResult = await this.getMenuData(
      interaction.guildId,
      menuName,
    );
    if (menuDataResult.err) {
      await interaction.reply({
        content: menuDataResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const role = menuDataResult.val.roles.find((r) => r.roleId === roleId);
    if (!role) {
      await interaction.reply({
        content: `Role <@&${roleId}> isn't in this menu yet. Use the role selector below to add it first, then you can edit its options.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Create modal
    const modal = new ModalBuilder()
      .setCustomId(`${ROLE_MENU_BUILDER_MODALS.ROLE_OPTIONS}:${roleId}`)
      .setTitle("Edit Role Options");

    const emojiInput = new TextInputBuilder()
      .setCustomId(ROLE_MENU_BUILDER_INPUTS.EMOJI)
      .setLabel("Emoji")
      .setStyle(TextInputStyle.Short)
      .setMaxLength(50)
      .setValue(role.emoji || "")
      .setRequired(false);

    const descriptionInput = new TextInputBuilder()
      .setCustomId(ROLE_MENU_BUILDER_INPUTS.ROLE_DESCRIPTION)
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(100)
      .setValue(role.description || "")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    );

    await interaction.showModal(modal);

    try {
      const modalSubmission = await interaction.awaitModalSubmit({
        time: 120000, // 2 minutes
      });

      if (!modalSubmission.isFromMessage()) {
        throw new Error("Modal submission is not from a message interaction");
      }

      const emojiStr = modalSubmission.fields.getTextInputValue(
        ROLE_MENU_BUILDER_INPUTS.EMOJI,
      );
      const description = modalSubmission.fields.getTextInputValue(
        ROLE_MENU_BUILDER_INPUTS.ROLE_DESCRIPTION,
      );

      let parsedEmoji;
      if (emojiStr) {
        parsedEmoji = parseEmoji(emojiStr);

        if (!parsedEmoji) {
          await modalSubmission.reply({
            content:
              "Invalid emoji format. Use standard Unicode emojis (😀) or Discord custom emojis (<:name:id>). Example: 🎮 or <:gaming:123456789>.",
            flags: MessageFlags.Ephemeral,
          });

          return;
        }
      }

      // Update role options
      await this.roleMenuRoleService.updateRoleOptions({
        guildId: interaction.guildId,
        menuName,
        roleId,
        emoji: parsedEmoji?.string,
        description: description || undefined,
      });

      await this.refreshBuilderMessage(modalSubmission, menuName, isEdit);
    } catch (err) {
      this.logger.debug(
        { interactionId: interaction.id, err },
        "Role options modal submission timed out or failed",
      );
    }
  }

  private async handleRoleSelectMenu(
    interaction: RoleSelectMenuInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    const selectedRoleIds = interaction.values;

    const userHighestRolePosition =
      interaction.user.id !== interaction.guild.ownerId
        ? interaction.member.roles.highest.position
        : undefined;

    const setResult = await this.roleMenuRoleService.setRoles(
      interaction.guildId,
      menuName,
      selectedRoleIds,
      interaction.guild,
      userHighestRolePosition,
    );

    if (setResult.err) {
      await interaction.reply({
        content: setResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Roles were set successfully, warnings will be shown in the refreshed builder
    await this.refreshBuilderMessage(interaction, menuName, isEdit);
  }

  private async handleRequiredRoleSelectMenu(
    interaction: RoleSelectMenuInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    const requiredRoleId = interaction.values[0] || undefined;

    // Update menu
    await this.roleMenuManagementService.updateMenu({
      guildId: interaction.guildId,
      menuName,
      requiredRole: requiredRoleId,
    });

    await this.refreshBuilderMessage(interaction, menuName, isEdit);
  }

  private async refreshBuilderMessage(
    interaction:
      | MessageComponentInteraction<"cached">
      | ModalMessageModalSubmitInteraction<"cached">,
    menuName: string,
    isEdit: boolean,
  ): Promise<void> {
    // Get updated data
    const menuDataResult = await this.getMenuData(
      interaction.guildId,
      menuName,
    );
    if (menuDataResult.err) {
      await interaction.reply({
        content: menuDataResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const { menu, roles } = menuDataResult.val;

    // Mark active menus as needing update when editing
    if (isEdit) {
      try {
        await this.roleMenuMessageService.markMenuNeedsUpdate(
          interaction.guildId,
          menuName,
        );
      } catch (error) {
        this.logger.warn(
          { err: error, guildId: interaction.guildId, menuName },
          "Failed to mark menu as needing update",
        );
        // Don't fail the refresh, just log the warning
      }
    }

    // Get active menu count for display
    let activeMenuCount = 0;
    if (isEdit) {
      try {
        const activeMessages = await this.roleMenuMessageService.getActiveMenus(
          interaction.guildId,
          menuName,
        );
        activeMenuCount = activeMessages.length;
      } catch (error) {
        this.logger.warn(
          { err: error, guildId: interaction.guildId, menuName },
          "Failed to get active menu count for builder",
        );
      }
    }

    // Check bot permissions for current roles
    const roleIds = roles.map((role) => role.roleId);
    const permissionWarnings = this.roleMenuRoleService.validateBotPermissions(
      interaction.guild,
      roleIds,
    );

    // Create updated message
    const updatedMessage = createRoleMenuBuilderMessage({
      menu,
      roles,
      guild: interaction.guild,
      state: {
        guildId: interaction.guildId,
        menuName,
        disabled: false,
        expired: false,
        isEdit,
        activeMenuCount,
        permissionWarnings,
      },
    });

    await interaction.update(updatedMessage);
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    this.activeSessions.forEach((session, key) => {
      const age = now - session.startTime.getTime();
      if (age > RoleMenuCreateCommand.SESSION_TIMEOUT_MS) {
        // 5 minutes
        this.activeSessions.delete(key);
        cleanedCount++;
        this.logger.debug(
          {
            sessionKey: key,
            userId: session.userId,
            age: Math.floor(age / 1000) + "s",
          },
          "Cleaned up stale role menu editing session",
        );
      }
    });

    if (cleanedCount > 0) {
      this.logger.info(
        { cleanedCount, remainingSessions: this.activeSessions.size },
        "Cleaned up stale role menu sessions",
      );
    }
  }

  private async buildMenuContent(
    guildId: string,
    menuName: string,
    guild: Guild,
  ): Promise<
    Result<
      {
        embeds: (APIEmbed | JSONEncodable<APIEmbed>)[];
        components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
      },
      string
    >
  > {
    // Get menu from database
    const menuResult = await this.roleMenuManagementService.getMenu(
      guildId,
      menuName,
    );
    if (menuResult.err) {
      return Err(menuResult.val);
    }

    const menu = menuResult.val;

    // Get roles for the menu
    const rolesResult = await this.roleMenuRoleService.getRoles(
      guildId,
      menuName,
    );
    if (rolesResult.err) {
      return Err(rolesResult.val);
    }

    const roles = rolesResult.val;

    if (roles.length === 0) {
      return Err("This menu has no roles configured.");
    }

    // Get guild role names
    const guildRoles = Array.from(guild.roles.cache.values());
    const guildRolesMap = guildRoles.reduce((map, role) => {
      if (role) {
        map.set(role.id, role);
      }
      return map;
    }, new Map<string, Role>());

    // Build embed
    const fields = [];
    if (menu.requiredRole) {
      fields.push({
        name: "Required role",
        value: `<@&${menu.requiredRole}>`,
      });
    }

    if (menu.maxCount) {
      fields.push({
        name: "Maximum roles you can pick",
        value: menu.maxCount.toString(),
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(menuName)
      .setDescription(menu.description || null)
      .setFields(fields)
      .setColor(Color.Info);

    // Build components for both button and select menu formats
    const buttonComponents: ActionRowBuilder<MessageActionRowComponentBuilder>[] =
      [];
    const selectComponents: ActionRowBuilder<MessageActionRowComponentBuilder>[] =
      [];

    // Build button components
    let buttonRow = new ActionRowBuilder<ButtonBuilder>();
    for (const { roleId, emoji } of roles) {
      let button = new ButtonBuilder()
        .setCustomId(
          roleMenuCustomIds.shortButton.compile({
            id: menu.id.toString(),
            roleId,
          }),
        )
        .setLabel(
          this.truncateButtonLabel(guildRolesMap.get(roleId)?.name || roleId),
        )
        .setStyle(ButtonStyle.Secondary);

      const parsedEmoji = emoji ? parseEmoji(emoji) : null;
      if (parsedEmoji) {
        button = button.setEmoji({
          id: parsedEmoji.emoji.id || undefined,
          animated: parsedEmoji.emoji.animated,
          name: parsedEmoji.emoji.name || undefined,
        });
      }

      // Row full, push to component rows list
      if (buttonRow.components.length === 5) {
        buttonComponents.push(
          buttonRow as ActionRowBuilder<MessageActionRowComponentBuilder>,
        );
        buttonRow = new ActionRowBuilder<ButtonBuilder>();
      }

      buttonRow = buttonRow.addComponents([button]);
    }

    // Add any remaining buttons
    if (buttonRow.components.length > 0) {
      buttonComponents.push(
        buttonRow as ActionRowBuilder<MessageActionRowComponentBuilder>,
      );
    }

    // Build select menu components
    const selectOptions = [];
    for (const { roleId, emoji, description } of roles) {
      let option = new StringSelectMenuOptionBuilder()
        .setValue(roleId)
        .setLabel(
          this.truncateSelectLabel(guildRolesMap.get(roleId)?.name || roleId),
        );

      const parsedEmoji = emoji ? parseEmoji(emoji) : null;
      if (parsedEmoji) {
        option = option.setEmoji({
          id: parsedEmoji.emoji.id || undefined,
          animated: parsedEmoji.emoji.animated,
          name: parsedEmoji.emoji.name || undefined,
        });
      }

      if (description) {
        option = option.setDescription(description);
      }

      selectOptions.push(option);
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setPlaceholder("Select your roles!")
      .setCustomId(
        roleMenuCustomIds.shortSelect.compile({ id: menu.id.toString() }),
      )
      .addOptions(selectOptions)
      .setMaxValues(menu.maxCount || roles.length)
      .setMinValues(0);

    const selectRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
        selectMenu,
      ]);
    selectComponents.push(
      selectRow as ActionRowBuilder<MessageActionRowComponentBuilder>,
    );

    // Set footer based on available interaction types
    embed.setFooter({
      text: "Click buttons or use the select menu to manage your roles",
    });

    // Return content with both button and select menu components for maximum compatibility
    return Ok({
      embeds: [embed.toJSON()],
      components: [...buttonComponents, ...selectComponents],
    });
  }

  private truncateButtonLabel(label: string): string {
    return label.length > 80 ? label.slice(0, 77) + "..." : label;
  }

  private truncateSelectLabel(label: string): string {
    return label.length > 100 ? label.slice(0, 97) + "..." : label;
  }
}
