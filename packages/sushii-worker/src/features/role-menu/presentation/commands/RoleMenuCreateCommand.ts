import { sleep } from "bun";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalMessageModalSubmitInteraction,
  RoleSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Logger } from "pino";

import parseEmoji from "@/utils/parseEmoji";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import {
  ROLE_MENU_BUILDER_CUSTOM_IDS,
  ROLE_MENU_BUILDER_INPUTS,
  ROLE_MENU_BUILDER_MODALS,
} from "../views/RoleMenuBuilderConstants";
import { createRoleMenuBuilderMessage } from "../views/RoleMenuBuilderView";

enum RoleMenuOption {
  Name = "menu_name",
}

export class RoleMenuCreateCommand {
  constructor(
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
    private readonly logger: Logger,
  ) {}

  private async getMenuData(guildId: string, menuName: string) {
    const menuResult = await this.roleMenuManagementService.getMenu(
      guildId,
      menuName,
    );
    const rolesResult = await this.roleMenuRoleService.getRoles(
      guildId,
      menuName,
    );

    return {
      menu: menuResult.ok ? menuResult.val : null,
      roles: rolesResult.ok ? rolesResult.val : [],
    };
  }

  async handle(
    interaction: ChatInputCommandInteraction<"cached">,
    isEdit: boolean,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No menu name provided.");
    }

    // For create mode, create or get existing menu
    // For edit mode, just get the existing menu
    if (!isEdit) {
      await this.roleMenuManagementService.createMenu({
        guildId: interaction.guildId,
        menuName,
      });
    }

    // Get menu and roles data
    const { menu, roles } = await this.getMenuData(
      interaction.guildId,
      menuName,
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
      },
    });

    const msg = await interaction.reply(builderMessage);

    // Create component collector
    const collector = msg.createMessageComponentCollector({
      idle: 600000, // 10 minutes
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
        const { menu: currentMenu, roles: currentRoles } =
          await this.getMenuData(interaction.guildId, menuName);

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
      }
    });
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
    const { menu } = await this.getMenuData(interaction.guildId, menuName);
    const currentDescription = menu?.description || "";

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
    const { menu } = await this.getMenuData(interaction.guildId, menuName);
    const currentMaxRoles = menu?.maxCount?.toString() || "";

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
            content: "Invalid number. Please enter a number between 1 and 25.",
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

  private async handleEditRoleOptionsButton(
    interaction: ButtonInteraction<"cached">,
    menuName: string,
    roleId: string,
    isEdit: boolean,
  ): Promise<void> {
    // Get current role options
    const { roles } = await this.getMenuData(interaction.guildId, menuName);
    const role = roles.find((r) => r.roleId === roleId);
    if (!role) {
      await interaction.reply({
        content: "Role not found in menu.",
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
            content: "Invalid emoji provided.",
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
    const { menu, roles } = await this.getMenuData(
      interaction.guildId,
      menuName,
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
      },
    });

    await interaction.update(updatedMessage);
  }
}
