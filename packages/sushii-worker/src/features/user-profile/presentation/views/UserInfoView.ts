import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";

import Color from "@/utils/colors";
import { getCreatedTimestampSeconds } from "@/utils/snowflake";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

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
    .setImage(user.bannerURL() || null)
    .setFooter({
      text: `ID: ${user.id}`,
    })
    .setColor(Color.Success);

  const createdTimestamp = getCreatedTimestampSeconds(user.id);

  embed = embed.addFields([
    {
      name: "Account Created",
      value: `<t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`,
    },
  ]);

  if (member) {
    embed = embed.setColor(member.displayColor);

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

    if (member.joinedTimestamp) {
      const joinTs = timestampToUnixTime(member.joinedTimestamp);

      embed = embed.addFields([
        {
          name: "Joined Server",
          value: `<t:${joinTs}:F> (<t:${joinTs}:R>)`,
        },
      ]);
    }

    if (member.premiumSinceTimestamp) {
      const premiumTs = timestampToUnixTime(member.premiumSinceTimestamp);

      embed = embed.addFields([
        {
          name: "Boosting Since",
          value: `<t:${premiumTs}:F> (<t:${premiumTs}:R>)`,
        },
      ]);
    }
  }

  return embed.toJSON();
}
