import type { GuildMember } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { LevelRoleSyncService } from "../../application/LevelRoleSyncService";
import { applyLevelRoles } from "./applyLevelRoles";

export class MemberJoinLevelRoleHandler extends EventHandler<Events.GuildMemberAdd> {
  constructor(private readonly levelRoleSyncService: LevelRoleSyncService) {
    super();
  }

  readonly eventType = Events.GuildMemberAdd;

  async handle(member: GuildMember): Promise<void> {
    // Giving roles to a member still in membership screening would let them
    // skip it. They get their roles on their first message after screening.
    if (member.user.bot || member.pending) {
      return;
    }

    const changes = await this.levelRoleSyncService.getRoleChangesForMember(
      member.guild.id,
      member.id,
    );

    if (!changes) {
      return;
    }

    await applyLevelRoles(
      member,
      changes.level,
      changes.addRoleIds,
      changes.removeRoleIds,
      { trigger: "member_join" },
    );
  }
}
