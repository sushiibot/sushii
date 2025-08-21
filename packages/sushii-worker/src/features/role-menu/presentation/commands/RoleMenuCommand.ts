import type { ChatInputCommandInteraction, Role } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { SlashCommandHandler } from "@/interactions/handlers";
import {
  interactionReplyErrorMessage,
  interactionReplyErrorPlainMessage,
} from "@/interactions/responses/error";
import Color from "@/utils/colors";
import parseEmoji from "@/utils/parseEmoji";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";

enum RoleMenuOption {
  Name = "menu_name",
  NewName = "new_menu_name",
  Description = "description",
  Emoji = "emoji",
  RoleOption = "role",
  Roles = "roles",
  MaxRoles = "max_roles",
  RequiredRole = "required_role",
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
        .setName("new")
        .setDescription("Create a new role menu.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the role menu.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Description)
            .setDescription("The content of the role menu.")
            .setRequired(false),
        )
        .addIntegerOption((o) =>
          o
            .setName(RoleMenuOption.MaxRoles)
            .setDescription("The maximum number of roles to allow.")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(25),
        )
        .addRoleOption((o) =>
          o
            .setName(RoleMenuOption.RequiredRole)
            .setDescription("A role that the user must have to use this menu")
            .setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("edit")
        .setDescription("Edit a role menu's options.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the role menu to edit.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.NewName)
            .setDescription("The new name of the role menu.")
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Description)
            .setDescription("The new content of the role menu.")
            .setRequired(false),
        )
        .addIntegerOption((o) =>
          o
            .setName(RoleMenuOption.MaxRoles)
            .setDescription("The new maximum number of roles to allow.")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(25),
        )
        .addRoleOption((o) =>
          o
            .setName(RoleMenuOption.RequiredRole)
            .setDescription("A role that the user must have to use this menu")
            .setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("editorder")
        .setDescription("Change the order of a rolemenu's roles.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the menu to add the roles to.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Roles)
            .setDescription("The new order of the roles in the menu.")
            .setRequired(true),
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
        .setName("addroles")
        .setDescription("Add roles to a menu.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the menu to add the roles to.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Roles)
            .setDescription("The roles to add, you can add multiple at a time.")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("removeroles")
        .setDescription("Remove roles from a menu.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the menu to remove the roles from.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Roles)
            .setDescription(
              "The roles to remove, you can add multiple at a time.",
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("roleoptions")
        .setDescription("Add extra information to a rolemenu's role.")
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Name)
            .setDescription("The name of the menu to add the roles to.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addRoleOption((o) =>
          o
            .setName(RoleMenuOption.RoleOption)
            .setDescription("The role to update.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Emoji)
            .setDescription("An emoji to represent the role in the menu.")
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName(RoleMenuOption.Description)
            .setDescription(
              "A description for the role. Only shows for select menus.",
            )
            .setMaxLength(100)
            .setRequired(false),
        ),
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
        )
        .addChannelOption((o) =>
          o
            .setName(RoleMenuOption.Channel)
            .setDescription(
              "The channel to send the role menu to, by default the current channel.",
            )
            .addChannelTypes(
              ChannelType.GuildAnnouncement,
              ChannelType.GuildText,
            )
            .setRequired(false),
        ),
    )
    .toJSON();

  constructor(
    private readonly roleMenuManagementService: RoleMenuManagementService,
    private readonly roleMenuRoleService: RoleMenuRoleService,
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
      case "new":
        return this.newHandler(interaction);
      case "get":
        return this.getHandler(interaction);
      case "list":
        return this.listHandler(interaction);
      case "edit":
        return this.editHandler(interaction);
      case "editorder":
        return this.editOrderHandler(interaction);
      case "addroles":
        return this.addRolesHandler(interaction);
      case "removeroles":
        return this.removeRolesHandler(interaction);
      case "roleoptions":
        return this.roleOptionsHandler(interaction);
      case "delete":
        return this.deleteHandler(interaction);
      case "send":
        return this.sendHandler(interaction);
      default:
        throw new Error("Invalid subcommand.");
    }
  }

  private async newHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const name = interaction.options.getString(RoleMenuOption.Name);
    if (!name) {
      throw new Error("No name provided.");
    }

    const description = interaction.options.getString(
      RoleMenuOption.Description,
    );
    const maxRoles = interaction.options.getInteger(RoleMenuOption.MaxRoles);
    const requiredRole = interaction.options.getRole(
      RoleMenuOption.RequiredRole,
    );

    const result = await this.roleMenuManagementService.createMenu({
      guildId: interaction.guildId,
      menuName: name,
      description: description || undefined,
      maxCount: maxRoles || undefined,
      requiredRole: requiredRole?.id,
    });

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
          .setTitle("Created a new role menu")
          .setFields([
            {
              name: "Name",
              value: name,
            },
            {
              name: "Description",
              value: description || "No description set.",
            },
            {
              name: "Max Roles",
              value: maxRoles?.toString() || "No limit on max roles.",
            },
            {
              name: "Required Role",
              value: requiredRole
                ? `<@&${requiredRole.id}>`
                : "No required role.",
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
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
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const roles = rolesResult.val;
    const rolesStr = roles
      .map((r) => {
        let s = `<@&${r.roleId}>`;

        if (r.emoji && !r.description) {
          s += `\n┗ **Emoji:** ${r.emoji}`;
        } else if (r.emoji) {
          s += `\n┣ **Emoji:** ${r.emoji}`;
        }

        if (r.description) {
          s += `\n┗ **Description:** ${r.description}`;
        }

        return s;
      })
      .join("\n");

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Role menu information")
          .setFields([
            {
              name: "Name",
              value: name,
            },
            {
              name: "Description",
              value: menu.description || "No description set.",
            },
            {
              name: "Max Roles",
              value: menu.maxCount?.toString() || "No limit on max roles.",
            },
            {
              name: "Required Role",
              value: menu.requiredRole
                ? `<@&${menu.requiredRole}>`
                : "No required role.",
            },
            {
              name: "Roles",
              value: rolesStr || "No roles are added yet!",
            },
          ])
          .setColor(Color.Success)
          .setFooter({
            text: "Emojis may not show up here but they will still display in menus.",
          })
          .toJSON(),
      ],
    });
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

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("All role menus")
          .setDescription(menus.map((n) => n.menuName).join("\n"))
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async editHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No name provided.");
    }

    const newName = interaction.options.getString(RoleMenuOption.NewName);
    const description = interaction.options.getString(
      RoleMenuOption.Description,
    );
    const maxCount = interaction.options.getInteger(RoleMenuOption.MaxRoles);
    const requiredRole = interaction.options.getRole(
      RoleMenuOption.RequiredRole,
    );

    const result = await this.roleMenuManagementService.updateMenu({
      guildId: interaction.guildId,
      menuName,
      newMenuName: newName || undefined,
      description: description || undefined,
      maxCount: maxCount || undefined,
      requiredRole: requiredRole?.id,
    });

    if (result.err) {
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    // Get updated menu for display
    const menuResult = await this.roleMenuManagementService.getMenu(
      interaction.guildId,
      newName || menuName,
    );

    if (menuResult.err) {
      await interaction.reply({
        content: menuResult.val,
        ephemeral: true,
      });
      return;
    }

    const menu = menuResult.val;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Edited role menu")
          .setColor(Color.Success)
          .setFields([
            {
              name: "Name",
              value: newName || menuName,
            },
            {
              name: "Description",
              value: menu.description || "No description set.",
            },
            {
              name: "Max Roles",
              value: menu.maxCount?.toString() || "No limit on max roles.",
            },
            {
              name: "Required Role",
              value: menu.requiredRole
                ? `<@&${menu.requiredRole}>`
                : "No required role.",
            },
          ])
          .toJSON(),
      ],
    });
  }

  private async editOrderHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No menu name provided.");
    }

    const roles = interaction.options.getString(RoleMenuOption.Roles);
    if (!roles) {
      throw new Error("No role provided.");
    }

    const result = await this.roleMenuRoleService.reorderRoles(
      interaction.guildId,
      menuName,
      roles,
    );

    if (result.err) {
      await interactionReplyErrorPlainMessage(interaction, result.val);
      return;
    }

    const { newOrder, previousOrder } = result.val;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Updated role menu order")
          .setFields([
            {
              name: "New order",
              value: newOrder.map((id) => `<@&${id}>`).join(" "),
            },
            {
              name: "Previous order",
              value: previousOrder.map((id) => `<@&${id}>`).join(" "),
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async addRolesHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No menu name provided.");
    }

    const roles = interaction.options.getString(RoleMenuOption.Roles);
    if (!roles) {
      throw new Error("No role provided.");
    }

    const userHighestRolePosition =
      interaction.user.id !== interaction.guild.ownerId
        ? interaction.member.roles.highest.position
        : undefined;

    const result = await this.roleMenuRoleService.addRoles(
      interaction.guildId,
      menuName,
      roles,
      interaction.guild,
      userHighestRolePosition,
    );

    if (result.err) {
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    const { addedRoles, newTotalRoles } = result.val;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Added roles to role menu")
          .setFields([
            {
              name: "Added roles",
              value: addedRoles.map((id) => `<@&${id}>`).join(" "),
            },
            {
              name: "New menu roles",
              value: newTotalRoles.map((id) => `<@&${id}>`).join(" "),
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async removeRolesHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No name provided.");
    }

    const roles = interaction.options.getString(RoleMenuOption.Roles);
    if (!roles) {
      throw new Error("No role provided.");
    }

    const result = await this.roleMenuRoleService.removeRoles(
      interaction.guildId,
      menuName,
      roles,
    );

    if (result.err) {
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    const { removedRoles, remainingRoles } = result.val;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Removed roles from menu")
          .setFields([
            {
              name: "Removed roles",
              value: removedRoles.map((id) => `<@&${id}>`).join(" "),
            },
            {
              name: "Remaining menu roles",
              value:
                remainingRoles.map((id) => `<@&${id}>`).join(" ") ||
                "Menu has no roles",
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async roleOptionsHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No name provided.");
    }

    const role = interaction.options.getRole(RoleMenuOption.RoleOption);
    if (!role) {
      throw new Error("No role provided.");
    }

    const emojiStr = interaction.options.getString(RoleMenuOption.Emoji);
    const description = interaction.options.getString(
      RoleMenuOption.Description,
    );

    if (!emojiStr && !description) {
      await interactionReplyErrorMessage(
        interaction,
        "You must provide either an emoji or description to update.",
      );
      return;
    }

    let parsedEmoji;
    if (emojiStr) {
      parsedEmoji = parseEmoji(emojiStr);
      if (!parsedEmoji) {
        await interactionReplyErrorMessage(
          interaction,
          "Invalid emoji provided.",
        );
        return;
      }
    }

    const result = await this.roleMenuRoleService.updateRoleOptions({
      guildId: interaction.guildId,
      menuName,
      roleId: role.id,
      emoji: parsedEmoji?.string,
      description: description || undefined,
    });

    if (result.err) {
      await interaction.reply({
        content: result.val,
        ephemeral: true,
      });
      return;
    }

    const fields = [];
    if (parsedEmoji) {
      fields.push({
        name: "Emoji",
        value: parsedEmoji.string,
      });
    }
    if (description) {
      fields.push({
        name: "Description",
        value: description,
      });
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Updated role options")
          .setFields(fields)
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async deleteHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const name = interaction.options.getString(RoleMenuOption.Name);
    if (!name) {
      throw new Error("No name provided.");
    }

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
        "This menu has no roles. Add some roles before sending it.",
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
          .setCustomId(customIds.roleMenuButton.compile({ roleId }))
          .setLabel(guildRolesMap.get(roleId)?.name || roleId)
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
          .setLabel(guildRolesMap.get(roleId)?.name || roleId);

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
        .setCustomId(customIds.roleMenuSelect.compile())
        .addOptions(selectOptions)
        .setMaxValues(menu.maxCount || roles.length)
        .setMinValues(0); // Allow clearing all roles

      const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents([selectMenu])
        .toJSON();
      components.push(row);
    }

    try {
      await sendChannel.send({
        embeds: [embed.toJSON()],
        components,
      });
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
