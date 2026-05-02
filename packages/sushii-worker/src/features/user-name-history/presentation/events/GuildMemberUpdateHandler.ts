import { Events } from "discord.js";
import type { GuildMember, PartialGuildMember } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { UserNameHistoryService } from "../../application";

export class UserNameHistoryGuildMemberUpdateHandler extends EventHandler<Events.GuildMemberUpdate> {
  constructor(private readonly service: UserNameHistoryService) {
    super();
  }

  readonly eventType = Events.GuildMemberUpdate;

  async handle(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    // When oldMember is partial (not cached), we can't compare previous values.
    // Record all current values unconditionally — insertIfChanged will dedup against
    // any previously stored entries, so this only writes rows when values are new.
    const old = oldMember.partial ? null : oldMember;

    // username and globalName come from the user object embedded in the member event.
    // GUILD_MEMBER_UPDATE fires when the user object changes, not just guild-specific fields.
    const promises: Promise<void>[] = [];

    if (!old || old.user.username !== newMember.user.username) {
      promises.push(
        this.service.recordUsernameChange(
          newMember.user.id,
          newMember.user.username,
        ),
      );
    }

    if (!old || old.user.globalName !== newMember.user.globalName) {
      promises.push(
        this.service.recordGlobalNameChange(
          newMember.user.id,
          newMember.user.globalName,
        ),
      );
    }

    // Nickname is guild-scoped
    if (!old || old.nickname !== newMember.nickname) {
      promises.push(
        this.service.recordNicknameChange(
          newMember.guild.id,
          newMember.user.id,
          newMember.nickname,
        ),
      );
    }

    await Promise.all(promises);
  }
}
