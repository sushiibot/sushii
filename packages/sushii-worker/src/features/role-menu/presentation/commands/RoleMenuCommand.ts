import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  DiscordAPIError,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { interactionReplyErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuMessageService } from "../../application/RoleMenuMessageService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import type { RoleMenuRepository } from "../../domain/repositories/RoleMenuRepository";
import { createRoleMenuBuilderMessage } from "../views/RoleMenuBuilderView";
import { createRoleMenuMessage } from "../views/RoleMenuView";
import type { RoleMenuCreateCommand } from "./RoleMenuCreateCommand";

enum RoleMenuOption {
  Name = "menu_name",
  Channel = "channel",
  Type = "type",
}

enum RoleMenuType {
  SelectMenu = "select_menu",
  Buttons = "buttons",
}

export class RoleMenuCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("rolemenu")
    .setDescription("Create a role menu.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((c) =>
      c
        .setName("create")
        .setDescription("Create a role menu with an interactive builder.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the role menu.")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("edit")
        .setDescription("Edit a role menu with an interactive builder.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the role menu to edit.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("get")
        .setDescription("Get current information about a role menu.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the role menu.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((c) =>
      c.setName("list").setDescription("List all your role menus."),
    )
    .addSubcommand((c) =>
      c
        .setName("delete")
        .setDescription("Delete a role menu.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the menu to add the roles to.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("send")
        .setDescription("Send a role menu to a channel.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the role menu.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addChannelOption((o) =>
          o
            .setName(RoleMenuOption.Channel)
            .setDescription("The channel to send the role menu to.")
            .addChannelTypes(
              ChannelType.GuildAnnouncement,
              ChannelType.GuildText,
            )
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Type)
            .setDescription("The type of menu to send.")
            .setRequired(true)
            .setChoices(
              {
                name: "Select menu",
                value: RoleMenuType.SelectMenu,
              },
              {
                name: "Buttons",
                value: RoleMenuType.Buttons,
              },
            ),
        ),
    )
    .toJSON();

  constructor(
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
    private readonly roleMenuMessageService: RoleMenuMessageService,
    private readonly roleMenuRepository: RoleMenuRepository,
    private readonly roleMenuCreateCommand: RoleMenuCreateCommand,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("This command can only be used in a server.");
    }

    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "create":
        return this.createHandler(interaction);
      case "get":
        return this.getHandler(interaction);
      case "list":
        return this.listHandler(interaction);
      case "edit":
        return this.editHandler(interaction);
      case "delete":
        return this.deleteHandler(interaction);
      case "send":
        return this.sendHandler(interaction);
      default:
        throw new Error("Invalid subcommand.");
    }
  }

  private async createHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    return this.roleMenuCreateCommand.handle(interaction, false);
  }

  private async getHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const name = interaction.options.getString(RoleMenuOption.Name);
    if (!name) {
      throw new Error("No name provided.");
    }

    const menuResult = await this.roleMenuManagementService.getMenu(
      interaction.guildId,
      name,
    );
    if (menuResult.err) {
      await interaction.reply({
        content: menuResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const menu = menuResult.val;
    const rolesResult = await this.roleMenuRoleService.getRoles(
      interaction.guildId,
      name,
    );
    if (rolesResult.err) {
      await interaction.reply({
        content: rolesResult.val,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const roles = rolesResult.val;

    // Get active menus for this specific menu
    const activeMessages = await this.roleMenuRepository.getActiveMessages(
      interaction.guildId,
      name,
    );

    // Prepare active menu info if any exist
    let activeMenuInfo;
    if (activeMessages.length > 0) {
      const needsUpdateCount = activeMessages.filter(
        (m) => m.needsUpdate,
      ).length;
      const links = activeMessages.map(
        (msg) =>
          `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId} ${msg.needsUpdate ? "⚠️" : "✅"}`,
      );

      activeMenuInfo = {
        totalCount: activeMessages.length,
        needsUpdateCount,
        links,
      };
    }

    // Create read-only builder message with active menu info
    const builderMessage = createRoleMenuBuilderMessage({
      menu,
      roles,
      guild: interaction.guild,
      state: {
        guildId: interaction.guildId,
        menuName: name,
        disabled: true,
        expired: false,
        readOnly: true,
      },
      activeMenuInfo,
    });

    await interaction.reply(builderMessage);
  }

  private async listHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menus = await this.roleMenuManagementService.listMenus(
      interaction.guildId,
    );

    if (menus.length === 0) {
      await interaction.reply({
        content: "No role menus found.",
      });
      return;
    }

    // Get active menu status
    const activeMenusStatus =
      await this.roleMenuMessageService.getActiveMenusWithStatus(
        interaction.guildId,
      );

    const menuDescriptions = menus.map((menu) => {
      const status = activeMenusStatus.get(menu.menuName);
      if (!status || status.count === 0) {
        return `• **${menu.menuName}** - No active menus`;
      }

      if (status.needsUpdate === 0) {
        return `• **${menu.menuName}** - ${status.count} active ✅`;
      }

      if (status.count >= 5) {
        return `• **${menu.menuName}** - ${status.count} active (${status.needsUpdate} need updates) ⚠️ (at limit)`;
      }

      return `• **${menu.menuName}** - ${status.count} active (${status.needsUpdate} need updates)`;
    });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Your Role Menus")
          .setDescription(menuDescriptions.join("\n"))
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async editHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    return this.roleMenuCreateCommand.handle(interaction, true);
  }

  private async deleteHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const name = interaction.options.getString(RoleMenuOption.Name);
    if (!name) {
      throw new Error("No name provided.");
    }

    // Check if menu exists first
    const menuResult = await this.roleMenuManagementService.getMenu(
      interaction.guildId,
      name,
    );

    if (menuResult.err) {
      await interaction.reply({
        content: menuResult.val,
        ephemeral: true,
      });
      return;
    }

    // Get active messages for confirmation
    const activeMessages = await this.roleMenuRepository.getActiveMessages(
      interaction.guildId,
      name,
    );

    if (activeMessages.length > 0) {
      const links = activeMessages.map(
        (msg) =>
          `• https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId}`,
      );

      const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_delete_menu:${name}`)
        .setLabel("Delete menu and remove all")
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_delete_menu:${name}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        confirmButton,
        cancelButton,
      );

      const confirmReply = await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️ Delete Confirmation")
            .setDescription(
              `This will delete "${name}" and remove ${activeMessages.length} active menus:\n${links.join("\n")}`,
            )
            .setColor(Color.Warning)
            .toJSON(),
        ],
        components: [row.toJSON()],
        ephemeral: true,
        withResponse: true,
      });

      if (!confirmReply.resource?.message) {
        throw new Error("Failed to get confirmation message resource");
      }

      let confirmation;
      try {
        confirmation =
          await confirmReply.resource.message.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id,
            time: 60_000,
            componentType: ComponentType.Button,
          });
      } catch (_err) {
        // Timed out — disable buttons
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Delete Cancelled")
              .setDescription("Confirmation timed out.")
              .setColor(Color.Warning)
              .toJSON(),
          ],
          components: [],
        });
        return;
      }

      if (confirmation.customId === `cancel_delete_menu:${name}`) {
        await confirmation.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("Delete Cancelled")
              .setDescription(`Cancelled deletion of "${name}".`)
              .setColor(Color.Warning)
              .toJSON(),
          ],
          components: [],
        });
        return;
      }

      // Confirmed — remove active Discord messages first
      if (interaction.channel?.isTextBased()) {
        const removeResult = await this.roleMenuMessageService.removeActiveMenus(
          interaction.guildId,
          name,
          interaction.channel as TextChannel,
        );

        if (removeResult.err) {
          this.logger.warn(
            { err: removeResult.val, menuName: name },
            "Failed to remove some active menus during deletion",
          );
        }
      }

      // Delete the menu record
      const deleteResult = await this.roleMenuManagementService.deleteMenu(
        interaction.guildId,
        name,
      );

      if (deleteResult.err) {
        await confirmation.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("Error")
              .setDescription(deleteResult.val)
              .setColor(Color.Error)
              .toJSON(),
          ],
          components: [],
        });
        return;
      }

      await confirmation.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Deleted role menu")
            .setDescription(
              `Menu "${name}" and ${activeMessages.length} active menus have been deleted.`,
            )
            .setColor(Color.Success)
            .toJSON(),
        ],
        components: [],
      });
      return;
    }

    // No active messages, proceed with deletion
    const result = await this.roleMenuManagementService.deleteMenu(
      interaction.guildId,
      name,
    );

    if (result.err) {
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Deleted role menu")
          .setDescription(`Menu "${name}" has been deleted.`)
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async sendHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const name = interaction.options.getString(RoleMenuOption.Name);
    if (!name) {
      throw new Error("No name provided.");
    }

    const sendChannel =
      interaction.options.getChannel(RoleMenuOption.Channel) ||
      interaction.channel;

    if (!sendChannel || !sendChannel.isTextBased()) {
      throw new Error("No channel provided or is not text based.");
    }

    const type = interaction.options.getString(RoleMenuOption.Type);
    if (!type) {
      throw new Error("No type provided.");
    }

    // Get menu from database
    const menuResult = await this.roleMenuManagementService.getMenu(
      interaction.guildId,
      name,
    );
    if (menuResult.err) {
      await interaction.reply({
        content: menuResult.val,
        ephemeral: true,
      });
      return;
    }

    const _menu = menuResult.val;

    // Get roles for the menu
    const rolesResult = await this.roleMenuRoleService.getRoles(
      interaction.guildId,
      name,
    );
    if (rolesResult.err) {
      await interaction.reply({
        content: rolesResult.val,
        ephemeral: true,
      });
      return;
    }

    const roles = rolesResult.val;

    if (roles.length === 0) {
      await interactionReplyErrorMessage(
        interaction,
        `This menu has no roles. Use \`/rolemenu edit menu_name:${name}\` to add roles before sending it.`,
      );
      return;
    }

    // Check if we've hit the limit of 5 active menus
    const activeMessages = await this.roleMenuRepository.getActiveMessages(
      interaction.guildId,
      name,
    );

    if (activeMessages.length >= 5) {
      const links = activeMessages.map(
        (msg) =>
          `• https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId}`,
      );

      await interactionReplyErrorMessage(
        interaction,
        `❌ This menu already has 5 active copies (maximum).\nRemove an existing one first:\n${links.join("\n")}`,
      );
      return;
    }

    // Use the view function to build the menu content
    const menuContent = createRoleMenuMessage({
      menu: _menu,
      roles,
      guild: interaction.guild,
      type: type as "buttons" | "select_menu",
    });

    const components = menuContent.components.map((c) => c.toJSON());

    try {
      const sentMessage = await sendChannel.send({
        embeds: [menuContent.embed.toJSON()],
        components,
      });

      // Track the sent message
      const trackResult = await this.roleMenuMessageService.trackSentMenu(
        interaction.guildId,
        name,
        sendChannel.id,
        sentMessage.id,
        type as "buttons" | "select_menu",
      );

      if (trackResult.err) {
        this.logger.warn(
          { err: trackResult.val, messageId: sentMessage.id },
          "Failed to track sent menu message",
        );
        // Don't fail the command, just warn
      }
    } catch (err) {
      this.logger.error({ err }, "Error sending role menu message");
      if (err instanceof DiscordAPIError) {
        await interaction.reply({
          content: `Failed to send message: ${err.message}`,
          ephemeral: true,
        });
        return;
      }
      throw err;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Sent role menu")
          .setDescription(`<#${sendChannel.id}>`)
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }
}
