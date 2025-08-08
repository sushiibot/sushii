import { EmbedBuilder, GuildMember, User } from "discord.js";
import { APIEmbed } from "discord.js";

import Color from "@/utils/colors";
import { getUserString } from "@/utils/userString";

type BannerResult = 
  | { success: true; embeds: APIEmbed[] }
  | { success: false; errorEmbed: APIEmbed };

export function createBannerEmbeds(
  user: User,
  member: GuildMember | undefined,
): BannerResult {
  const userBannerURL = user.bannerURL({
    size: 4096,
  });

  const memberBannerURL = member?.bannerURL({
    size: 4096,
  });

  // If no banners at all, return error
  if (!userBannerURL && !memberBannerURL) {
    const errorEmbed = new EmbedBuilder()
      .setColor(Color.Error)
      .setDescription(`${user.toString()} doesn't have a banner set.`);

    return { success: false, errorEmbed: errorEmbed.toJSON() };
  }

  const embeds = [];

  // Add user banner if exists
  if (userBannerURL) {
    const userEmbed = new EmbedBuilder()
      .setTitle(getUserString(user))
      .setURL(userBannerURL)
      .setImage(userBannerURL)
      .setColor(Color.Success);

    embeds.push(userEmbed.toJSON());
  }

  // Add member banner if exists
  if (memberBannerURL) {
    const memberEmbed = new EmbedBuilder()
      .setTitle("Server Banner")
      .setURL(memberBannerURL)
      .setImage(memberBannerURL)
      .setColor(Color.Success);

    embeds.push(memberEmbed.toJSON());
  }

  return { success: true, embeds };
}