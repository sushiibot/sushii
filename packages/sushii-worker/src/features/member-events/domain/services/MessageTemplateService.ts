import type { GuildMember, PartialGuildMember } from "discord.js";

export const MAX_MESSAGE_LENGTH = 2000;

// Discord caps each allowed_mentions id list at 100 entries.
const MAX_ALLOWED_MENTION_IDS = 100;

const PLACEHOLDER_REGEX = /<username>|<mention>|<server>|<member_number>/g;
const USER_MENTION_REGEX = /<@!?(\d{17,20})>/g;
const ROLE_MENTION_REGEX = /<@&(\d{17,20})>/g;
const EVERYONE_REGEX = /@(everyone|here)/;

export interface TemplateAllowedMentions {
  parse: "everyone"[];
  users: string[];
  roles: string[];
}

export interface TemplateMessage {
  content: string;
  allowedMentions: TemplateAllowedMentions;
}

export class MessageTemplateService {
  replaceTemplate(
    template: string,
    member: GuildMember | PartialGuildMember,
  ): string {
    // Single pass with a function replacer so `$&`, `$1`, `$$` etc. in user or
    // server names are inserted literally, and substituted values are never
    // re-scanned for placeholders.
    return template.replace(PLACEHOLDER_REGEX, (placeholder) => {
      switch (placeholder) {
        case "<username>":
          return member.user.username;
        case "<mention>":
          return member.user.toString();
        case "<server>":
          return member.guild.name;
        case "<member_number>":
          return member.guild.memberCount.toString();
        default:
          return placeholder;
      }
    });
  }

  /**
   * Builds a sendable message from an admin-written template. Only mentions
   * the joining member plus mentions written directly in the template are
   * allowed to ping, so names containing @everyone or role mentions can't.
   */
  buildMessage(
    template: string,
    member: GuildMember | PartialGuildMember,
  ): TemplateMessage {
    const content = truncate(this.replaceTemplate(template, member));

    const templateUserIds = [...template.matchAll(USER_MENTION_REGEX)].map(
      (match) => match[1],
    );
    const templateRoleIds = [...template.matchAll(ROLE_MENTION_REGEX)].map(
      (match) => match[1],
    );

    return {
      content,
      allowedMentions: {
        parse: EVERYONE_REGEX.test(template) ? ["everyone"] : [],
        users: [...new Set([member.user.id, ...templateUserIds])].slice(
          0,
          MAX_ALLOWED_MENTION_IDS,
        ),
        roles: [...new Set(templateRoleIds)].slice(0, MAX_ALLOWED_MENTION_IDS),
      },
    };
  }
}

function truncate(content: string): string {
  if (content.length <= MAX_MESSAGE_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}
