import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { ChannelHealth } from "../../application/SettingsStatus";

const REQUIRED_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: "View Channel" },
  { flag: PermissionFlagsBits.SendMessages, name: "Send Messages" },
  { flag: PermissionFlagsBits.EmbedLinks, name: "Embed Links" },
] as const;

function checkOne(guild: Guild, channelId: string): ChannelHealth {
  const channel = guild.channels.cache.get(channelId);
  const botMember = guild.members.me;
  if (!channel || !botMember || !channel.isTextBased()) {
    return { kind: "missing_channel" };
  }

  const permissions = channel.permissionsFor(botMember);
  if (!permissions) {
    return { kind: "missing_channel" };
  }

  const missing = REQUIRED_PERMISSIONS.filter(
    ({ flag }) => !permissions.has(flag),
  ).map(({ name }) => name);

  if (missing.length > 0) {
    return { kind: "missing_permissions", permissions: missing };
  }

  return { kind: "ok" };
}

export function checkChannelHealth(
  guild: Guild,
  channelIds: string[],
): Map<string, ChannelHealth> {
  const health = new Map<string, ChannelHealth>();
  for (const channelId of channelIds) {
    if (!health.has(channelId)) {
      health.set(channelId, checkOne(guild, channelId));
    }
  }

  return health;
}
