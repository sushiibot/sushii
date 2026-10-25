import {
  type Guild,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";

const MODERATOR_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
];

/** Owner and staff are never screened. Roles come from the event payload; their permissions from this cluster's guild cache. */
export function isScreeningExempt(
  guild: Guild,
  userId: string,
  roleIds: readonly string[],
): boolean {
  if (guild.ownerId === userId) {
    return true;
  }

  // The @everyone role shares the guild's id and isn't listed in member roles.
  let bits = guild.roles.cache.get(guild.id)?.permissions.bitfield ?? 0n;
  for (const id of roleIds) {
    bits |= guild.roles.cache.get(id)?.permissions.bitfield ?? 0n;
  }

  return new PermissionsBitField(bits).any(MODERATOR_PERMISSIONS);
}
