import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";
import { t } from "i18next";

import Color from "@/utils/colors";

export function createAvatarEmbeds(
  user: User,
  member: GuildMember | undefined,
): APIEmbed[] {
  const embeds = [];

  // User avatar
  const userFaceURL = user.displayAvatarURL({
    size: 4096,
  });

  const userEmbed = new EmbedBuilder()
    .setTitle(
      t("avatar.user_avatar_title", {
        ns: "commands",
        username: user.username,
      }),
    )
    .setURL(userFaceURL)
    .setImage(userFaceURL)
    .setColor(Color.Success)
    .toJSON();

  embeds.push(userEmbed);

  // Guild avatar (if exists)
  if (member) {
    // Not displayAvatarURL since we don't want it to fallback to user pfp
    const memberFaceURL = member.avatarURL({
      size: 4096,
    });

    if (memberFaceURL) {
      const memberEmbed = new EmbedBuilder()
        .setTitle(
          t("avatar.member_avatar_title", {
            ns: "commands",
            username: member.nickname || user.username,
          }),
        )
        .setURL(memberFaceURL)
        .setImage(memberFaceURL)
        .setColor(Color.Success)
        .toJSON();

      embeds.push(memberEmbed);
    }
  }

  return embeds;
}