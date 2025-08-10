import type { GuildMember, PartialGuildMember } from "discord.js";

export class MessageTemplateService {
  replaceTemplate(
    template: string,
    member: GuildMember | PartialGuildMember,
  ): string {
    return template
      .replace(/<username>/g, member.user.username)
      .replace(/<mention>/g, member.user.toString())
      .replace(/<server>/g, member.guild.name)
      .replace(/<member_number>/g, member.guild.memberCount.toString());
  }
}