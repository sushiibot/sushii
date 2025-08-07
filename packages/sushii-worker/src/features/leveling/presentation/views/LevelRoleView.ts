import { EmbedBuilder, InteractionReplyOptions } from "discord.js";

import Color from "@/utils/colors";

import { LevelRole } from "../../domain/entities/LevelRole";

export function formatCreateSuccess(
  levelRole: LevelRole,
): InteractionReplyOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Created a new level role")
        .setFields([
          {
            name: "Role",
            value: `<@&${levelRole.getRoleId()}>`,
          },
          {
            name: "Add level",
            value: levelRole.getAddLevel()?.toString() ?? "Not set",
          },
          {
            name: "Remove level",
            value:
              levelRole.getRemoveLevel()?.toString() ??
              "Role will not be automatically removed",
          },
        ])
        .setColor(Color.Success)
        .toJSON(),
    ],
  };
}

export function formatDeleteSuccess(roleId: string): InteractionReplyOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Deleted level role")
        .setFields([
          {
            name: "Role",
            value: `<@&${roleId}>`,
          },
        ])
        .setColor(Color.Success)
        .toJSON(),
    ],
  };
}

export function formatList(levelRoles: LevelRole[]): InteractionReplyOptions {
  if (levelRoles.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("All level roles")
          .setDescription("There are no level roles")
          .setColor(Color.Success)
          .toJSON(),
      ],
    };
  }

  const roleDescriptions = levelRoles.map((levelRole) => {
    let description = `<@&${levelRole.getRoleId()}>`;

    const addLevel = levelRole.getAddLevel();
    if (addLevel !== null) {
      description += ` at level ${addLevel}`;
    }

    const removeLevel = levelRole.getRemoveLevel();
    if (removeLevel !== null) {
      description += ` and removed at level ${removeLevel}`;
    }

    return description;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("All level roles")
        .setDescription(roleDescriptions.join("\n"))
        .setColor(Color.Success)
        .toJSON(),
    ],
  };
}
