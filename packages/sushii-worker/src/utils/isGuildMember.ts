import type { APIInteractionDataResolvedGuildMember } from "discord.js";
import { GuildMember } from "discord.js";

export default function isGuildMember(
  m: GuildMember | APIInteractionDataResolvedGuildMember,
): m is GuildMember {
  return m instanceof GuildMember;
}
