import type { ChatInputCommandInteraction, Role } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { interactionReplyErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";
import parseEmoji from "@/utils/parseEmoji";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuMessageService } from "../../application/RoleMenuMessageService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
import { roleMenuCustomIds } from "../constants/roleMenuCustomIds";
import { createRoleMenuBuilderMessage } from "../views/RoleMenuBuilderView";
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
    const activeMessages = await this.roleMenuMessageService.getActiveMenus(
      interaction.guildId,
      name,
    );

    // Create read-only builder message
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
    });

    // Add active menu information if any exist
    if (activeMessages.length > 0) {
      const needsUpdateCount = activeMessages.filter(
        (m) => m.needsUpdate,
      ).length;
      const links = activeMessages.map(
        (msg) =>
          `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId} ${msg.needsUpdate ? "⚠️" : "✅"}`,
      );

      const statusText =
        needsUpdateCount === 0
          ? `📍 **Active Menus:** ${activeMessages.length} total`
          : `📍 **Active Menus:** ${activeMessages.length} total (${needsUpdateCount} need updates)`;

      const activeMenuEmbed = new EmbedBuilder()
        .setTitle(statusText)
        .setDescription(links.join("\n"))
        .setColor(needsUpdateCount > 0 ? Color.Warning : Color.Success);

      // Add update button if needed
      const components = [];
      if (needsUpdateCount > 0) {
        const updateButton = new ButtonBuilder()
          .setCustomId(`update_outdated_menus:${name}`)
          .setLabel("Update Outdated Menus")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🔄");

        components.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(updateButton),
        );
      }

      if (builderMessage.embeds) {
        builderMessage.embeds = [
          ...builderMessage.embeds,
          activeMenuEmbed.toJSON(),
        ];
      }
      if (components.length > 0 && builderMessage.components) {
        builderMessage.components = [
          ...builderMessage.components,
          ...components.map((c) => c.toJSON()),
        ];
      }
    }

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
    const activeMessages = await this.roleMenuMessageService.getActiveMenus(
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

      await interaction.reply({
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

    const menu = menuResult.val;

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
    const activeMessages = await this.roleMenuMessageService.getActiveMenus(
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

    // Get guild role names
    const guildRoles = Array.from(interaction.guild.roles.cache.values());
    const guildRolesMap = guildRoles.reduce((map, role) => {
      if (role) {
        map.set(role.id, role);
      }
      return map;
    }, new Map<string, Role>());

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

    let footerText = "";
    if (type === RoleMenuType.SelectMenu) {
      footerText = "Remove all selections to clear your roles";
    } else if (type === RoleMenuType.Buttons) {
      footerText = "Click buttons again to remove roles";
    }

    const embed = new EmbedBuilder()
      .setTitle(name)
      .setDescription(menu.description || null)
      .setFields(fields)
      .setColor(Color.Info)
      .setFooter({
        text: footerText,
      });

    // Build components
    const components = [];
    if (type === RoleMenuType.Buttons) {
      let row = new ActionRowBuilder<ButtonBuilder>();

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
        if (row.components.length === 5) {
          components.push(row.toJSON());
          row = new ActionRowBuilder<ButtonBuilder>();
        }

        row = row.addComponents([button]);
      }

      // Add any remaining buttons
      if (row.components.length > 0) {
        components.push(row.toJSON());
      }
    }

    if (type === RoleMenuType.SelectMenu) {
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
        .setMinValues(0); // Allow clearing all roles

      const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents([selectMenu])
        .toJSON();
      components.push(row);
    }

    try {
      const sentMessage = await sendChannel.send({
        embeds: [embed.toJSON()],
        components,
      });

      // Track the sent message
      const trackResult = await this.roleMenuMessageService.trackSentMenu(
        interaction.guildId,
        name,
        sendChannel.id,
        sentMessage.id,
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

  private truncateButtonLabel(label: string): string {
    return label.length > 80 ? label.slice(0, 77) + "..." : label;
  }

  private truncateSelectLabel(label: string): string {
    return label.length > 100 ? label.slice(0, 97) + "..." : label;
  }
}
