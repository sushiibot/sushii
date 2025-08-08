import type { User } from "discord.js";
import { GuildMember } from "discord.js";

export function getUsernameString(user: User): string {
  return `${user.displayName} (@${user.tag})`;
}

export function getMemberString(member: GuildMember): string {
  return member.nickname
    ? `${member.nickname} ~ ${member.user.displayName} (@${member.user.tag})`
    : getUsernameString(member.user);
}

export function getUserString(user: User | GuildMember): string {
  if (user instanceof GuildMember) {
    return getMemberString(user);
  }

  return `${user.displayName} (@${user.tag})`;
}
