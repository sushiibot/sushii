import type { Guild, GuildMember } from "discord.js";
import { GuildMFALevel, OverwriteType } from "discord.js";

import type {
  GuildSnapshot,
  MemberSnapshot,
  OverwriteSnapshot,
  RoleSnapshot,
  SelfAssignableRole,
} from "../domain/GuildSnapshot";

/** Roles and channels come from the gateway; members only from what was fetched. */
export function buildGuildSnapshot(
  guild: Guild,
  fetched: ReadonlyMap<string, GuildMember>,
  holderCounts: ReadonlyMap<string, number>,
  selfAssignable: readonly SelfAssignableRole[],
  now: Date,
): GuildSnapshot {
  const holders = new Map<string, string[]>();
  for (const member of fetched.values()) {
    for (const roleId of member.roles.cache.keys()) {
      holders.set(roleId, [...(holders.get(roleId) ?? []), member.id]);
    }
  }

  const roles: RoleSnapshot[] = guild.roles.cache.map((role) => ({
    id: role.id,
    name: role.name,
    position: role.position,
    permissions: role.permissions.bitfield,
    botUserId: role.tags?.botId ?? null,
    createdAt: role.createdAt,
    // The counts endpoint leaves out @everyone.
    holderCount:
      role.id === guild.id
        ? guild.memberCount
        : (holderCounts.get(role.id) ?? 0),
    holderIds: holders.get(role.id) ?? [],
  }));

  const overwrites: OverwriteSnapshot[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (!("permissionOverwrites" in channel)) {
      continue;
    }

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.allow.bitfield === 0n && overwrite.deny.bitfield === 0n) {
        continue;
      }

      overwrites.push({
        channelId: channel.id,
        channelName: channel.name,
        targetId: overwrite.id,
        targetType: overwrite.type === OverwriteType.Role ? "role" : "member",
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
      });
    }
  }

  const members = new Map<string, MemberSnapshot>(
    [...fetched.values()].map((member) => [
      member.id,
      {
        id: member.id,
        username: member.user.username,
        isBot: member.user.bot,
        roleIds: member.roles.cache
          .filter((role) => role.id !== guild.id)
          .map((role) => role.id),
        joinedAt: member.joinedAt,
      },
    ]),
  );

  return {
    guildId: guild.id,
    ownerId: guild.ownerId,
    everyoneRoleId: guild.id,
    mfaRequired: guild.mfaLevel === GuildMFALevel.Elevated,
    roles,
    overwrites,
    memberCount: guild.memberCount,
    members,
    selfAssignable,
    now,
  };
}
