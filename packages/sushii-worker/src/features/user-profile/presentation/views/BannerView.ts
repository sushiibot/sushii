import { EmbedBuilder, GuildMember, User } from "discord.js";
import { APIEmbed } from "discord.js";

import Color from "@/utils/colors";
import { getUserString } from "@/utils/userString";

export function createBannerEmbeds(
  user: User,
  member: GuildMember | undefined,
): APIEmbed[] | { error: APIEmbed } {
  const userBannerURL = user.bannerURL({
    size: 4096,
  });

  const memberBannerURL = member?.bannerURL({
    size: 4096,
  });

  if (!userBannerURL) {
    const errorEmbed = new EmbedBuilder()
      .setColor(Color.Error)
      .setDescription(`${user.toString()} doesn't have a banner set.`);

    return { error: errorEmbed.toJSON() };
  }

  const embeds = [];

  const userEmbed = new EmbedBuilder()
    .setTitle(getUserString(user))
    .setURL(userBannerURL)
    .setImage(userBannerURL)
    .setColor(Color.Success);

  embeds.push(userEmbed.toJSON());

  if (memberBannerURL) {
    const memberEmbed = new EmbedBuilder()
      .setTitle("Server Banner")
      .setURL(memberBannerURL)
      .setImage(memberBannerURL)
      .setColor(Color.Success);

    embeds.push(memberEmbed.toJSON());
  }

  return embeds;
}