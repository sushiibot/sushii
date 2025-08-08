import type {
  ChatInputCommandInteraction,
  Role} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  ButtonStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  DiscordAPIError,
  InteractionContextType,
} from "discord.js";
import { t } from "i18next";
import type { Option} from "ts-results";
import { None, Some } from "ts-results";
import logger from "@/shared/infrastructure/logger";
import Color from "../../utils/colors";
import parseEmoji from "../../utils/parseEmoji";
import customIds from "../customIds";
import { SlashCommandHandler } from "../handlers";
import {
  interactionReplyErrorMessage,
  interactionReplyErrorPlainMessage,
} from "../responses/error";
import {
  addRoleMenuRoles,
  deleteRoleMenu,
  deleteRoleMenuRoles,
  getRoleMenu,
  getRoleMenuRole,
  getRoleMenuRoles,
  listRoleMenus,
  reorderRoleMenuRoles,
  upsertRoleMenu,
  upsertRoleMenuRole,
} from "../../db/RoleMenu/ModLog.repository";
import db from "../../infrastructure/database/db";
import type { RoleMenuRow } from "../../db/RoleMenu/RoleMenu.table";

const RE_ROLE = /(?:<@&)?(\d{17,20})>?/g;

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

export default class RoleMenuCommand extends SlashCommandHandler {
  /**
   * /rolemenu new [title] (description) (max roles) (required_role)
   * /rolemenu edit [message id] (title) (description) (max roles) (required_role)
   * /rolemenu role add [role] (label) (description) (emoji)
   * /rolemenu role remove [role]
   */
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
        .setDescription("Edit a role menu's interaction.options.")
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

    // -------------------------------------------------------------------------
    // Check if menu name already exists

    // Does not fetch message from Discord API, not needed
    const menu = await this.getMenu(interaction, name);
    if (menu.some) {
      await interaction.reply({
        content: t("rolemenu.new.error.name_already_exists", { name }),
      });

      return;
    }

    // -------------------------------------------------------------------------
    // Create menu

    const description = interaction.options.getString(
      RoleMenuOption.Description,
    );
    const maxRoles = interaction.options.getInteger(RoleMenuOption.MaxRoles);
    const requiredRole = interaction.options.getRole(
      RoleMenuOption.RequiredRole,
    );

    // Save to DB
    await upsertRoleMenu(db, {
      guild_id: interaction.guildId,
      menu_name: name,
      required_role: requiredRole?.id,
      description,
      max_count: maxRoles,
    });

    // TODO: Add role select menu to this message, so that the user can
    // immediately add roles to the menu.
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
                ? `<&@${requiredRole.id}>`
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

    const menu = await this.getMenu(interaction, name);
    if (menu.none) {
      await interaction.reply({
        content: t("rolemenu.get.error.not_found", { name }),
      });

      return;
    }

    const menuData = menu.safeUnwrap();

    const roles = await getRoleMenuRoles(db, interaction.guildId, name);

    const rolesStr = roles
      .map((r) => {
        let s = `<@&${r.role_id}>`;

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
          .setTitle("Created a new role menu")
          .setFields([
            {
              name: "Name",
              value: name,
            },
            {
              name: "Description",
              value: menuData.description || "No description set.",
            },
            {
              name: "Max Roles",
              value: menuData.max_count?.toString() || "No limit on max roles.",
            },
            {
              name: "Required Role",
              value: menuData.required_role
                ? `<&@${menuData.required_role}>`
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
    const menus = await listRoleMenus(db, interaction.guildId);

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
          .setDescription(menus.map((n) => n.menu_name).join("\n"))
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

    const roleMenu = await this.getMenu(interaction, menuName);

    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found", { name: menuName }),
      });

      return;
    }

    const menuData = roleMenu.safeUnwrap();

    const newName = interaction.options.getString(RoleMenuOption.NewName);
    if (newName) {
      const newMenuNameExists = await this.getMenu(interaction, newName);

      if (newMenuNameExists.some) {
        await interaction.reply({
          content: t("rolemenu.edit.error.menu_name_exists", { name: newName }),
        });

        return;
      }
    }

    const description = interaction.options.getString(
      RoleMenuOption.Description,
    );
    const maxCount = interaction.options.getInteger(RoleMenuOption.MaxRoles);
    const requiredRole = interaction.options.getRole(
      RoleMenuOption.RequiredRole,
    );

    // Save to DB, fall back to previous value if not provided
    await upsertRoleMenu(db, {
      guild_id: interaction.guildId,
      menu_name: newName || menuName,
      required_role: requiredRole?.id || menuData.required_role,
      description: description || menuData.description,
      max_count: maxCount || menuData.max_count,
    });

    const requiredRoleId = requiredRole?.id || menuData.required_role;

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
              value:
                description || menuData.description || "No description set.",
            },
            {
              name: "Max Roles",
              value:
                maxCount?.toString() ||
                menuData.max_count?.toString() ||
                "No limit on max roles.",
            },
            {
              name: "Required Role",
              value: requiredRoleId
                ? `<@&${requiredRoleId}>`
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

    const roleMenu = await this.getMenu(interaction, menuName);
    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found"),
      });

      return;
    }

    const roles = interaction.options.getString(RoleMenuOption.Roles);
    if (!roles) {
      throw new Error("No role provided.");
    }

    // First match to get the ID group
    const roleIds = [...roles.matchAll(RE_ROLE)].map((match) => match[1]);
    if (!roleIds) {
      await interaction.reply({
        content: t("rolemenu.addroles.error.no_roles_given"),
      });

      return;
    }

    const currentRoles = await getRoleMenuRoles(
      db,
      interaction.guildId,
      menuName,
    );

    const currentRoleIDs = currentRoles.map((r) => r.role_id);

    const currentRoleIDsSet = new Set(currentRoleIDs);
    const newOrderRoleIDsSet = new Set(roleIds);

    // Check if new order contains exactly the same roles, no more, no less
    if (
      currentRoleIDsSet.size !== newOrderRoleIDsSet.size ||
      !currentRoleIDs.every((id) => newOrderRoleIDsSet.has(id))
    ) {
      await interactionReplyErrorPlainMessage(
        interaction,
        t("rolemenu.editorder.error.mismatched_roles", {
          name: menuName,
          roles: currentRoleIDs.map((id) => `<@&${id}>`).join(", "),
        }),
      );

      return;
    }

    await reorderRoleMenuRoles(db, interaction.guildId, menuName, roleIds);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Updated new role menu order")
          .setFields([
            {
              name: "New order",
              value: roleIds.map((id) => `<@&${id}>`).join(" "),
            },
            {
              name: "Previous order",
              value: currentRoleIDs.map((id) => `<@&${id}>`).join(" "),
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async addRolesHandlerMenu(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No menu name provided.");
    }

    const roleMenu = await this.getMenu(interaction, menuName);
    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found"),
      });

      return;
    }

    const roles = await getRoleMenuRoles(db, interaction.guildId, menuName);

    const currentRoleIDs = roles.map((r) => r.role_id);

    const selectMenu = new RoleSelectMenuBuilder()
      .setPlaceholder("Select roles to add to menu")
      .setMaxValues(25)
      .setCustomId(customIds.roleMenuAddRolesSelect.path);

    const userSelectMenu = new UserSelectMenuBuilder()
      .setPlaceholder("Select user")
      .setMaxValues(25)
      .setCustomId("moo");

    const rows = [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(selectMenu),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        userSelectMenu,
      ),
    ];

    // Send message with role menu select
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Add roles to menu")
          .setFields([
            {
              name: "Current roles",
              value:
                currentRoleIDs.map((id) => `<@&${id}>`).join(" ") ||
                "No roles added yet.",
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
      components: rows.map((r) => r.toJSON()),
    });
  }

  private async addRolesHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const menuName = interaction.options.getString(RoleMenuOption.Name);
    if (!menuName) {
      throw new Error("No menu name provided.");
    }

    const roleMenu = await this.getMenu(interaction, menuName);
    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found"),
      });

      return;
    }

    const roles = interaction.options.getString(RoleMenuOption.Roles);
    if (!roles) {
      throw new Error("No role provided.");
    }

    // First match to get the ID group
    const roleIds = [...roles.matchAll(RE_ROLE)].map((match) => match[1]);
    if (roleIds.length === 0) {
      await interaction.reply({
        content: t("rolemenu.addroles.error.no_roles_given"),
      });

      return;
    }

    // Only check for adding roles higher than own roles if the user is not the owner
    if (interaction.user.id !== interaction.guild.ownerId) {
      // Check that user is only adding roles that are lower than current role.
      // Prevents users from getting roles above their highest role.
      const highestRole = interaction.member.roles.highest;

      for (const roleId of roleIds) {
        const role = interaction.guild.roles.cache.get(roleId);
        // If trying to add a role that is higher than the user's current highest
        // role.
        if (role && highestRole && role.position > highestRole.position) {
          await interaction.reply({
            content: t("rolemenu.addroles.error.higher_role_given"),
          });

          return;
        }
      }
    }

    // Add new roles to the menu
    const menuRoles = await getRoleMenuRoles(db, interaction.guildId, menuName);

    let newAllRoleIds = menuRoles.map((r) => r.role_id);
    newAllRoleIds = newAllRoleIds.concat(roleIds);

    // Deduplicate -- sets are ordered so this should preserve order
    newAllRoleIds = [...new Set(newAllRoleIds)];

    if (newAllRoleIds.length > 25) {
      await interaction.reply({
        content: t("rolemenu.addroles.error.too_many_roles"),
      });

      return;
    }

    await addRoleMenuRoles(db, interaction.guildId, menuName, roleIds);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Added roles to role menu")
          .setFields([
            {
              name: "Added roles",
              value: roleIds.map((id) => `<@&${id}>`).join(" "),
            },
            {
              name: "New menu roles",
              value: newAllRoleIds.map((id) => `<@&${id}>`).join(" "),
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

    const roleMenu = await this.getMenu(interaction, menuName);
    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found"),
      });

      return;
    }

    const roles = interaction.options.getString(RoleMenuOption.Roles);
    if (!roles) {
      throw new Error("No role provided.");
    }

    const roleIdsToRemove = [...roles.matchAll(RE_ROLE)].map(
      (match) => match[1],
    );

    if (roleIdsToRemove.length === 0) {
      await interaction.reply({
        content: t("rolemenu.removeroles.error.no_roles_given"),
      });

      return;
    }

    // Remove roles from the menu
    const menuRoles = await getRoleMenuRoles(db, interaction.guildId, menuName);

    const newRoleIds = menuRoles
      .map((n) => n.role_id)
      .filter((id) => id && !roleIdsToRemove.includes(id));

    // Delete from db
    await deleteRoleMenuRoles(
      db,
      interaction.guildId,
      menuName,
      roleIdsToRemove,
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Delete roles from menu")
          .setFields([
            {
              name: "Removed roles",
              value: roleIdsToRemove.map((id) => `<@&${id}>`).join(" "),
            },
            {
              name: "New menu roles",
              value:
                newRoleIds?.map((id) => `<@&${id}>`).join(" ") ||
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

    const roleMenu = await this.getMenu(interaction, menuName);
    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found"),
      });

      return;
    }

    const role = interaction.options.getRole(RoleMenuOption.RoleOption);
    if (!role) {
      throw new Error("No role provided.");
    }

    const roleMenuRole = await getRoleMenuRole(
      db,
      interaction.guildId,
      menuName,
      role.id,
    );

    if (!roleMenuRole) {
      await interaction.reply({
        content: t("rolemenu.roleoptions.error.role_not_in_menu"),
      });

      return;
    }

    const emojiStr = interaction.options.getString(RoleMenuOption.Emoji);
    const description = interaction.options.getString(
      RoleMenuOption.Description,
    );

    if (!emojiStr && !description) {
      await interactionReplyErrorMessage(
        interaction,
        t("rolemenu.roleoptions.error.no_option_provided"),
      );

      return;
    }

    // Only parseEmoji if emojiStr is provided
    let parsedEmoji;
    if (emojiStr) {
      parsedEmoji = parseEmoji(emojiStr);

      // Error only sent when emojiStr is provided
      if (!parsedEmoji) {
        await interactionReplyErrorMessage(
          interaction,
          t("rolemenu.roleoptions.error.invalid_emoji"),
        );

        return;
      }

      roleMenuRole.emoji = parsedEmoji.string;
    }

    if (description) {
      // First check if description is too long
      if (description.length > 100) {
        await interactionReplyErrorMessage(
          interaction,
          t("rolemenu.roleoptions.error.description_too_long"),
        );

        return;
      }

      // Set description
      roleMenuRole.description = description;
    }

    await upsertRoleMenuRole(db, roleMenuRole);

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
          .setTitle("Added options to role")
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

    await deleteRoleMenu(db, interaction.guildId, name);

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

    // ------------------------------------------------------------
    // Get menu from db

    const roleMenu = await this.getMenu(interaction, name);
    if (roleMenu.none) {
      await interaction.reply({
        content: t("rolemenu.edit.error.menu_not_found"),
      });

      return;
    }

    const roleMenuData = roleMenu.safeUnwrap();

    // ------------------------------------------------------------
    // Get guild role names
    const guildRoles = Array.from(interaction.guild.roles.cache.values());

    const guildRolesMap = guildRoles.reduce((map, role) => {
      if (role) {
        map.set(role.id, role);
      }

      return map;
    }, new Map<string, Role>());

    const roles = await getRoleMenuRoles(db, interaction.guildId, name);

    if (roles.length === 0) {
      await interactionReplyErrorMessage(
        interaction,
        t("rolemenu.send.error.menu_has_no_roles"),
      );

      return;
    }

    if (roleMenuData.max_count && roles.length < roleMenuData.max_count) {
      await interactionReplyErrorMessage(
        interaction,
        t("rolemenu.send.error.menu_has_less_roles_than_max"),
      );

      return;
    }

    const fields = [];
    if (roleMenuData.required_role) {
      fields.push({
        name: "Required role",
        value: `<@&${roleMenuData.required_role}>`,
      });
    }

    if (roleMenuData.max_count) {
      fields.push({
        name: "Maximum roles you can pick",
        value: roleMenuData.max_count.toString(),
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
      .setDescription(roleMenuData.description || null)
      .setFields(fields)
      .setColor(Color.Info)
      .setFooter({
        text: footerText,
      });

    // --------------------------------------------------------------
    // Build buttons
    const components = [];
    if (type === RoleMenuType.Buttons) {
      let row = new ActionRowBuilder<ButtonBuilder>();

      for (const { role_id, emoji } of roles) {
        let button = new ButtonBuilder()
          .setCustomId(customIds.roleMenuButton.compile({ roleId: role_id }))
          .setLabel(guildRolesMap.get(role_id)?.name || role_id)
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

          // Create new row
          row = new ActionRowBuilder<ButtonBuilder>();
        }

        // Add component to row
        row = row.addComponents([button]);
      }

      // No more roles, check again if there are any remaining buttons
      if (row.components.length > 0) {
        components.push(row.toJSON());
      }
    }

    // --------------------------------------------------------------
    // Build select menu

    if (type === RoleMenuType.SelectMenu) {
      const selectOptions = [];

      for (const { role_id, emoji, description } of roles) {
        let option = new StringSelectMenuOptionBuilder()
          .setValue(role_id)
          .setLabel(guildRolesMap.get(role_id)?.name || role_id);

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
        .setMaxValues(roleMenuData.max_count || roles.length)
        // Allow 0 to let people clear all roles
        // Default is 1
        .setMinValues(0);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents([selectMenu])
        .toJSON();
      components.push(row);

      // Add a button for clearing all roles
    }

    if (sendChannel.isTextBased()) {
      try {
        await sendChannel.send({
          embeds: [embed.toJSON()],
          components,
        });
      } catch (err) {
        logger.error({ err }, "Error sending role menu message");
        if (err instanceof DiscordAPIError) {
          await interaction.reply({
            content: t("rolemenu.send.error.send_message", {
              error: err.message,
            }),
          });

          return;
        }
      }
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

  private async getMenu(
    interaction: ChatInputCommandInteraction<"cached">,
    menuName: string,
  ): Promise<Option<RoleMenuRow>> {
    const menu = await getRoleMenu(db, interaction.guildId, menuName);

    if (!menu) {
      return None;
    }

    return Some(menu);
  }
}
