import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

export interface ChannelPermissionStatus {
  channelId: string;
  hasViewChannel: boolean;
  hasSendMessages: boolean;
  hasEmbedLinks: boolean;
  missingPermissions: string[];
}

export type ChannelPermissionsMap = Record<string, ChannelPermissionStatus>;

const REQUIRED_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: "View Channel" },
  { flag: PermissionFlagsBits.SendMessages, name: "Send Messages" },
  { flag: PermissionFlagsBits.EmbedLinks, name: "Embed Links" },
] as const;

export function checkChannelPermissions(
  guild: Guild,
  channelId: string,
): ChannelPermissionStatus {
  const channel = guild.channels.cache.get(channelId);
  const botMember = guild.members.me;

  if (!channel || !botMember) {
    return {
      channelId,
      hasViewChannel: false,
      hasSendMessages: false,
      hasEmbedLinks: false,
      missingPermissions: ["View Channel", "Send Messages", "Embed Links"],
    };
  }

  const permissions = channel.permissionsFor(botMember);

  if (!permissions) {
    return {
      channelId,
      hasViewChannel: false,
      hasSendMessages: false,
      hasEmbedLinks: false,
      missingPermissions: ["View Channel", "Send Messages", "Embed Links"],
    };
  }

  const hasViewChannel = permissions.has(PermissionFlagsBits.ViewChannel);
  const hasSendMessages = permissions.has(PermissionFlagsBits.SendMessages);
  const hasEmbedLinks = permissions.has(PermissionFlagsBits.EmbedLinks);

  const missingPermissions: string[] = [];

  for (const { flag, name } of REQUIRED_PERMISSIONS) {
    if (!permissions.has(flag)) {
      missingPermissions.push(name);
    }
  }

  return {
    channelId,
    hasViewChannel,
    hasSendMessages,
    hasEmbedLinks,
    missingPermissions,
  };
}

export function checkMultipleChannelsPermissions(
  guild: Guild,
  channelIds: string[],
): ChannelPermissionsMap {
  const permissionsMap: ChannelPermissionsMap = {};

  for (const channelId of channelIds) {
    permissionsMap[channelId] = checkChannelPermissions(guild, channelId);
  }

  return permissionsMap;
}

export function formatPermissionWarning(
  permissionStatus: ChannelPermissionStatus,
): string | null {
  if (permissionStatus.missingPermissions.length === 0) {
    return null;
  }

  const missingPermsText = permissionStatus.missingPermissions.join(", ");
  return `⚠️ **Missing permissions:** ${missingPermsText}`;
}
