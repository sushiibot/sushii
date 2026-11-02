import { type Client, GuildFeature, PermissionFlagsBits } from "discord.js";

export type PublicChannelSkipReason =
  | "guild not in cache"
  | "guild not discoverable"
  | "channel not in cache"
  | "channel not public";

/** Null when the channel is visible to @everyone in a Discoverable server. */
export function publicChannelSkipReason(
  client: Client,
  guildId: string,
  channelId: string,
): PublicChannelSkipReason | null {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return "guild not in cache";
  }
  if (!guild.features.includes(GuildFeature.Discoverable)) {
    return "guild not discoverable";
  }

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    return "channel not in cache";
  }

  const everyonePerms = channel.permissionsFor(guild.roles.everyone);
  return everyonePerms?.has(PermissionFlagsBits.ViewChannel)
    ? null
    : "channel not public";
}
