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

import customIds from "@/interactions/customIds";
import { interactionReplyErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";
import parseEmoji from "@/utils/parseEmoji";

import type { RoleMenuManagementService } from "../../application/RoleMenuManagementService";
import type { RoleMenuRoleService } from "../../application/RoleMenuRoleService";
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
    return this.roleMenuCreateCommand.handle(interaction, true);
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
`This menu has no roles. Use \`/rolemenu edit menu_name:${name}\` to add roles before sending it.`,
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
