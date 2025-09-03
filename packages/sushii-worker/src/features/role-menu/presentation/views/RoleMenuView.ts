import type { Guild } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import Color from "@/utils/colors";
import parseEmoji from "@/utils/parseEmoji";

import type { RoleMenu } from "../../domain/entities/RoleMenu";
import type { RoleMenuRole } from "../../domain/entities/RoleMenuRole";
import { roleMenuCustomIds } from "../constants/roleMenuCustomIds";

interface RoleMenuViewOptions {
  menu: RoleMenu;
  roles: RoleMenuRole[];
  guild: Guild;
  type: "buttons" | "select_menu";
}

interface RoleMenuContent {
  embed: EmbedBuilder;
  components: ActionRowBuilder[];
}

export function createRoleMenuMessage(
  options: RoleMenuViewOptions,
): RoleMenuContent {
  const { menu, roles, guild, type } = options;

  // Get guild role names
  const guildRoles = Array.from(guild.roles.cache.values());
  const guildRolesMap = guildRoles.reduce((map, role) => {
    if (role) {
      map.set(role.id, role);
    }
    return map;
  }, new Map<string, { name: string }>());

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

  let footerText = "";
  if (type === "select_menu") {
    footerText = "Remove all selections to clear your roles";
  } else if (type === "buttons") {
    footerText = "Click buttons again to remove roles";
  }

  const embed = new EmbedBuilder()
    .setTitle(menu.menuName)
    .setDescription(menu.description || null)
    .setFields(fields)
    .setColor(Color.Info)
    .setFooter({
      text: footerText,
    });

  // Build components
  const components: ActionRowBuilder[] = [];

  if (type === "buttons") {
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
          truncateButtonLabel(guildRolesMap.get(roleId)?.name || roleId),
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
        components.push(row);
        row = new ActionRowBuilder<ButtonBuilder>();
      }

      row = row.addComponents([button]);
    }

    // Add any remaining buttons
    if (row.components.length > 0) {
      components.push(row);
    }
  }

  if (type === "select_menu") {
    const selectOptions = [];

    for (const { roleId, emoji, description } of roles) {
      let option = new StringSelectMenuOptionBuilder()
        .setValue(roleId)
        .setLabel(
          truncateSelectLabel(guildRolesMap.get(roleId)?.name || roleId),
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

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
      selectMenu,
    ]);
    components.push(row);
  }

  return {
    embed,
    components,
  };
}

function truncateButtonLabel(label: string): string {
  return label.length > 80 ? label.slice(0, 77) + "..." : label;
}

function truncateSelectLabel(label: string): string {
  return label.length > 100 ? label.slice(0, 97) + "..." : label;
}
