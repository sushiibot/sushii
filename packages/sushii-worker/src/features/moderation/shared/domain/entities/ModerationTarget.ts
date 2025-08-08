import type { GuildMember, User } from "discord.js";

export class ModerationTarget {
  constructor(
    private readonly _user: User,
    private readonly _member: GuildMember | null,
  ) {}

  get user(): User {
    return this._user;
  }

  get member(): GuildMember | null {
    return this._member;
  }

  get id(): string {
    return this._user.id;
  }

  get tag(): string {
    return this._user.tag;
  }

  get isInGuild(): boolean {
    return this._member !== null;
  }

  get displayName(): string {
    return this._member?.displayName || this._user.displayName;
  }

  get avatarURL(): string | null {
    return this._user.displayAvatarURL();
  }
}
