import type { Guild } from "discord.js";
import { GuildMFALevel, OverwriteType } from "discord.js";

import type {
  GuildSnapshot,
  MemberSnapshot,
  OverwriteSnapshot,
  RoleSnapshot,
  SelfAssignableRole,
} from "../domain/GuildSnapshot";

/**
 * One pass over the member cache. `role.members` filters the whole cache per
 * call, which is too slow per role on large guilds.
 */
export function holdersByRole(guild: Guild): Map<string, string[]> {
  const holders = new Map<string, string[]>();

  for (const member of guild.members.cache.values()) {
    for (const roleId of member.roles.cache.keys()) {
      if (roleId === guild.id) {
        continue;
      }
      const list = holders.get(roleId);
      if (list) {
        list.push(member.id);
      } else {
        holders.set(roleId, [member.id]);
      }
    }
  }

  return holders;
}

/** Cache only: the audit never waits on Discord. */
export function buildGuildSnapshot(
  guild: Guild,
  holders: ReadonlyMap<string, readonly string[]>,
  lastActiveAt: ReadonlyMap<string, Date>,
  selfAssignable: readonly SelfAssignableRole[],
  now: Date,
): GuildSnapshot {
  const roles: RoleSnapshot[] = guild.roles.cache.map((role) => ({
    id: role.id,
    name: role.name,
    position: role.position,
    permissions: role.permissions.bitfield,
    botUserId: role.tags?.botId ?? null,
    createdAt: role.createdAt,
    holderIds: holders.get(role.id) ?? [],
  }));

  const overwrites: OverwriteSnapshot[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (!("permissionOverwrites" in channel)) {
      continue;
    }

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.allow.bitfield === 0n) {
        continue;
      }

      overwrites.push({
        channelId: channel.id,
        channelName: channel.name,
        targetId: overwrite.id,
        targetType: overwrite.type === OverwriteType.Role ? "role" : "member",
        allow: overwrite.allow.bitfield,
      });
    }
  }

  const members = new Map<string, MemberSnapshot>(
    guild.members.cache.map((member) => [
      member.id,
      {
        id: member.id,
        username: member.user.username,
        isBot: member.user.bot,
        roleIds: member.roles.cache
          .filter((role) => role.id !== guild.id)
          .map((role) => role.id),
        joinedAt: member.joinedAt,
        lastActiveAt: lastActiveAt.get(member.id) ?? null,
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
    members,
    memberCacheComplete: guild.members.cache.size >= guild.memberCount,
    selfAssignable,
    now,
  };
}
