import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";

import Color from "@/utils/colors";
import { getCreatedTimestampSeconds } from "@/utils/snowflake";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

function formatTimestampField(unixSeconds: number): string {
  return `<t:${unixSeconds}:R>\n<t:${unixSeconds}:D>\n<t:${unixSeconds}:t>`;
}

function getUserType(user: User): "User" | "Bot" | "System" {
  if (user.system) return "System";
  if (user.bot) return "Bot";
  return "User";
}

export function createUserInfoEmbed(
  user: User,
  member: GuildMember | undefined,
): APIEmbed {
  let authorName = `${user.displayName} (@${user.username})`;
  if (member?.nickname) {
    authorName = `${user.displayName} (@${user.username}) ~ ${member.nickname}`;
  }

  const faceURL = member?.displayAvatarURL() || user.displayAvatarURL();

  let embed = new EmbedBuilder()
    .setAuthor({
      name: authorName,
      iconURL: faceURL,
      url: faceURL,
    })
    .setThumbnail(faceURL)
    .setImage(
      user.bannerURL({
        size: 2048,
      }) || null,
    )
    .setFooter({
      text: `ID: ${user.id}`,
    })
    .setColor(Color.Success);

  const createdTimestamp = getCreatedTimestampSeconds(user.id);

  embed = embed.addFields([
    {
      name: "Account Created",
      value: formatTimestampField(createdTimestamp),
    },
  ]);

  if (member) {
    embed = embed.setColor(member.displayColor);

    if (member.joinedTimestamp) {
      const joinTs = timestampToUnixTime(member.joinedTimestamp);

      embed = embed.addFields([
        {
          name: "Joined Server",
          value: formatTimestampField(joinTs),
        },
      ]);
    }
  }

  embed = embed.addFields([
    {
      name: "Account Type",
      value: getUserType(user),
    },
  ]);

  if (member) {
    if (member.premiumSinceTimestamp) {
      const premiumTs = timestampToUnixTime(member.premiumSinceTimestamp);

      embed = embed.addFields([
        {
          name: "Boosting Since",
          value: formatTimestampField(premiumTs),
        },
      ]);
    }

    // 1024 char limit, 40 roles * 25 length each mention = 1000
    const trimmedRoles = [...member.roles.cache.values()].slice(0, 40);
    let rolesStr = trimmedRoles.map((role) => role.toString()).join(" ");

    if (member.roles.cache.size > 40) {
      rolesStr += ` and ${member.roles.cache.size - 40} more roles...`;
    }

    embed = embed.addFields([
      {
        name: "Roles",
        value: rolesStr || "Member has no roles",
      },
    ]);
  }

  return embed.toJSON();
}
