import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";

import type { HelpAudience } from "@/features/help/domain/helpCatalog";
import {
  HELP_CATEGORIES,
  HELP_EMOJI_NAMES,
} from "@/features/help/domain/helpCatalog";
import type { HelpEmojis } from "@/features/help/presentation/views/HelpView";
import type { CommandMentions } from "@/shared/presentation/commandMentions";
import { fallbackMention } from "@/shared/presentation/commandMentions";

const AUDIENCE_PERMISSIONS: Record<HelpAudience, string | undefined> = {
  members: undefined,
  moderators: PermissionFlagsBits.BanMembers.toString(),
  admins: PermissionFlagsBits.ManageGuild.toString(),
};

const APP_TYPES: Record<string, ApplicationCommandType> = {
  "User Info": ApplicationCommandType.User,
  "Submit to Mods": ApplicationCommandType.Message,
  "Mod View": ApplicationCommandType.User,
  "View Reaction Starters": ApplicationCommandType.Message,
};

export function catalogCommandList(): RESTPostAPIApplicationCommandsJSONBody[] {
  return HELP_CATEGORIES.flatMap((category) => [
    ...category.commands.map(
      (c) =>
        ({
          name: c.name,
          description: c.name,
          default_member_permissions: AUDIENCE_PERMISSIONS[category.audience],
        }) as RESTPostAPIApplicationCommandsJSONBody,
    ),
    ...(category.apps ?? []).map(
      (name) =>
        ({
          name,
          type: APP_TYPES[name] ?? ApplicationCommandType.User,
          default_member_permissions: AUDIENCE_PERMISSIONS[category.audience],
        }) as RESTPostAPIApplicationCommandsJSONBody,
    ),
  ]);
}

function sub(name: string, description: string) {
  return { type: ApplicationCommandOptionType.Subcommand, name, description };
}

/** Catalog commands with real-shaped subcommands, a group, a hidden and an uncatalogued root. */
export function searchCommandList(): RESTPostAPIApplicationCommandsJSONBody[] {
  const subcommands: Record<string, unknown[]> = {
    rolemenu: [
      sub("create", "Start a new menu"),
      sub("edit", "Change title, description or limits"),
      sub("send", "Post a menu in a channel"),
    ],
    xp: [
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "block",
        description: "Block XP",
        options: [
          sub("channel", "Block XP in a channel"),
          sub("role", "Block XP for a role"),
        ],
      },
    ],
  };

  return [
    ...catalogCommandList().map((c) => {
      const options = subcommands[c.name];
      if (c.name === "rolemenu") {
        return {
          ...c,
          description: "Create a role menu.",
          default_member_permissions:
            PermissionFlagsBits.ManageRoles.toString(),
          options,
        } as RESTPostAPIApplicationCommandsJSONBody;
      }
      return options
        ? ({ ...c, options } as RESTPostAPIApplicationCommandsJSONBody)
        : c;
    }),
    {
      name: "help",
      description: "See what sushii can do",
    } as RESTPostAPIApplicationCommandsJSONBody,
    {
      name: "mystery",
      description: "Not in the catalog",
    } as RESTPostAPIApplicationCommandsJSONBody,
  ];
}

export const PERMISSIONS = {
  member: new PermissionsBitField(PermissionFlagsBits.SendMessages),
  moderator: new PermissionsBitField(PermissionFlagsBits.BanMembers),
  admin: new PermissionsBitField([
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageGuild,
  ]),
  manageGuildOnly: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
  rolesAdmin: new PermissionsBitField([
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
  ]),
};

export const ALL_EMOJIS = Object.fromEntries(
  HELP_EMOJI_NAMES.map((name, i) => [
    name,
    `<:${name}:${1400000000000000100n + BigInt(i)}>`,
  ]),
) as HelpEmojis;

export const NO_EMOJIS = Object.fromEntries(
  HELP_EMOJI_NAMES.map((name) => [name, ""]),
) as HelpEmojis;

export const KNOWN_MENTIONS: CommandMentions = {
  mention: (path) => `</${path}:1300000000000000000>`,
};

export const UNKNOWN_MENTIONS: CommandMentions = { mention: fallbackMention };
