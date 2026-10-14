import type {
  Guild,
  GuildMember,
  PermissionOverwriteOptions,
} from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import {
  type ChangeActor,
  type ChangeTarget,
  authorizeChange,
} from "../domain/authorizeChange";
import { type PlannedChange, permissionDiff } from "../domain/planChange";

/** Discord's per-guild role limit. */

export interface ApplyOutcome {
  /** The change went through, but not entirely as previewed. */
  warning?: string;
}

const CHANGED_SINCE_REPORT =
  "This changed after the report was made. Run `/permission-audit` again to get a fresh report.";

export class PermissionChangeService {
  constructor(private readonly logger: Logger) {}

  authorize(
    guild: Guild,
    runner: GuildMember,
    change: PlannedChange,
  ): Result<void, string> {
    const me = guild.members.me;
    if (!me) {
      return Err("sushii isn't in the member cache. Try again in a moment.");
    }

    return authorizeChange(change, this.target(guild, change), [
      this.actor("You", guild, runner, change),
      this.actor("sushii", guild, me, change),
    ]);
  }

  /**
   * Re-checks live state against the report snapshot so a stale report can
   * never overwrite someone else's edit. Discord API errors are thrown.
   */
  async apply(
    guild: Guild,
    runner: GuildMember,
    change: PlannedChange,
  ): Promise<Result<ApplyOutcome, string>> {
    const authorized = this.authorize(guild, runner, change);
    if (authorized.err) {
      return Err(authorized.val);
    }

    const reason = `Permission audit by ${runner.user.username}`;

    switch (change.kind) {
      case "set_role_permissions": {
        const role = guild.roles.cache.get(change.roleId);
        if (!role || role.permissions.bitfield !== change.before) {
          return Err(CHANGED_SINCE_REPORT);
        }
        await role.setPermissions(change.after, reason);
        return Ok({});
      }

      case "edit_overwrite": {
        const overwrite = this.overwrite(
          guild,
          change.channelId,
          change.targetId,
        );
        if (!overwrite || overwrite.allow.bitfield !== change.beforeAllow) {
          return Err(CHANGED_SINCE_REPORT);
        }
        // null resets a flag to inherit, which clears only that allow.
        const options: PermissionOverwriteOptions = Object.fromEntries(
          permissionDiff(change.beforeAllow, change.afterAllow).removed.map(
            (permission) => [permission, null],
          ),
        );
        await overwrite.edit(options, reason);
        return Ok({});
      }

      case "delete_overwrite": {
        const overwrite = this.overwrite(
          guild,
          change.channelId,
          change.targetId,
        );
        if (
          !overwrite ||
          overwrite.allow.bitfield !== change.beforeAllow ||
          overwrite.deny.bitfield !== change.beforeDeny
        ) {
          return Err(CHANGED_SINCE_REPORT);
        }
        await overwrite.delete(reason);
        return Ok({});
      }
    }
  }

  private target(guild: Guild, change: PlannedChange): ChangeTarget {
    const roleId =
      change.kind === "set_role_permissions" ? change.roleId : null;
    const role = roleId ? guild.roles.cache.get(roleId) : undefined;

    return {
      rolePosition: role?.position ?? null,
      roleName: role
        ? role.id === guild.id
          ? "@everyone"
          : `@${role.name}`
        : null,
    };
  }

  private actor(
    name: ChangeActor["name"],
    guild: Guild,
    member: GuildMember,
    change: PlannedChange,
  ): ChangeActor {
    const channel =
      change.kind === "edit_overwrite" || change.kind === "delete_overwrite"
        ? guild.channels.cache.get(change.channelId)
        : undefined;

    return {
      name,
      isOwner: member.id === guild.ownerId,
      permissions: member.permissions.bitfield,
      channelPermissions:
        channel && "permissionsFor" in channel
          ? (channel.permissionsFor(member)?.bitfield ?? null)
          : null,
      highestRolePosition: member.roles.highest.position,
    };
  }

  private overwrite(guild: Guild, channelId: string, targetId: string) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !("permissionOverwrites" in channel)) {
      return undefined;
    }
    return channel.permissionOverwrites.cache.get(targetId);
  }
}
