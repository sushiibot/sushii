import { PermissionFlagsBits } from "discord.js";

import type { Finding } from "./Finding";
import type { GuildSnapshot } from "./GuildSnapshot";
import type { PermissionName } from "./PermissionUsage";
import { permissionsIn } from "./permissionCatalog";

/**
 * Granted in place of Administrator. Pinned rather than "everything not
 * dangerous" so a permission Discord adds later is never granted unreviewed.
 */
export const NON_DANGEROUS_PERMISSIONS: readonly PermissionName[] = [
  "CreateInstantInvite",
  "AddReactions",
  "ViewAuditLog",
  "PrioritySpeaker",
  "Stream",
  "ViewChannel",
  "SendMessages",
  "SendTTSMessages",
  "EmbedLinks",
  "AttachFiles",
  "ReadMessageHistory",
  "UseExternalEmojis",
  "ViewGuildInsights",
  "Connect",
  "Speak",
  "UseVAD",
  "ChangeNickname",
  "UseApplicationCommands",
  "RequestToSpeak",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "UseExternalStickers",
  "SendMessagesInThreads",
  "UseEmbeddedActivities",
  "UseSoundboard",
  "CreateGuildExpressions",
  "CreateEvents",
  "UseExternalSounds",
  "SendVoiceMessages",
  "SendPolls",
  "UseExternalApps",
  "PinMessages",
  "BypassSlowmode",
];

const ALL_PERMISSIONS = Object.keys(PermissionFlagsBits) as PermissionName[];

export interface ChannelLoss {
  channelId: string;
  permissions: PermissionName[];
}

export type PlannedChange =
  | {
      kind: "set_role_permissions";
      roleId: string;
      before: bigint;
      after: bigint;
      affectedMembers: number;
      /** Channels whose overrides Administrator was bypassing. */
      channelLosses: ChannelLoss[];
    }
  | {
      kind: "edit_overwrite";
      channelId: string;
      targetId: string;
      targetType: "role" | "member";
      beforeAllow: bigint;
      afterAllow: bigint;
    }
  | {
      kind: "delete_overwrite";
      channelId: string;
      targetId: string;
      beforeAllow: bigint;
      beforeDeny: bigint;
    };

/** Null when the finding has no automatic fix. */
export function planChange(
  finding: Finding,
  guild: GuildSnapshot,
): PlannedChange | null {
  switch (finding.type) {
    case "everyone_dangerous":
      return removeFromRole(guild, finding.roleId, finding.permissions);

    case "unused_role_permission":
      return finding.lowConfidence
        ? null
        : removeFromRole(guild, finding.roleId, finding.permissions);

    case "administrator_grant":
      return finding.isBotRole || finding.lowConfidence
        ? null
        : replaceAdministrator(guild, finding.roleId, finding.usedPermissions);

    case "dangerous_overwrite": {
      const overwrite = findOverwrite(
        guild,
        finding.channelId,
        finding.targetId,
      );
      if (!overwrite) {
        return null;
      }
      return {
        kind: "edit_overwrite",
        channelId: finding.channelId,
        targetId: finding.targetId,
        targetType: finding.targetType,
        beforeAllow: overwrite.allow,
        afterAllow: overwrite.allow & ~bitsOf(finding.permissions),
      };
    }

    case "dead_overwrite": {
      const overwrite = findOverwrite(
        guild,
        finding.channelId,
        finding.targetId,
      );
      if (!overwrite) {
        return null;
      }
      return {
        kind: "delete_overwrite",
        channelId: finding.channelId,
        targetId: finding.targetId,
        beforeAllow: overwrite.allow,
        beforeDeny: overwrite.deny,
      };
    }

    case "possibly_used_through_bots":
    case "self_assignable_role":
    case "escalation":
    case "mfa_disabled":
      return null;
  }
}

/** What a change removes and adds, for previews. */
export function permissionDiff(
  before: bigint,
  after: bigint,
): { removed: PermissionName[]; added: PermissionName[] } {
  return {
    removed: permissionsIn(before & ~after, ALL_PERMISSIONS),
    added: permissionsIn(after & ~before, ALL_PERMISSIONS),
  };
}

function removeFromRole(
  guild: GuildSnapshot,
  roleId: string,
  permissions: readonly PermissionName[],
): PlannedChange | null {
  const role = guild.roles.find((r) => r.id === roleId);
  if (!role) {
    return null;
  }

  return {
    kind: "set_role_permissions",
    roleId,
    before: role.permissions,
    after: role.permissions & ~bitsOf(permissions),
    affectedMembers:
      roleId === guild.everyoneRoleId ? guild.memberCount : role.holderCount,
    channelLosses: [],
  };
}

function replaceAdministrator(
  guild: GuildSnapshot,
  roleId: string,
  usedPermissions: readonly PermissionName[],
): PlannedChange | null {
  const role = guild.roles.find((r) => r.id === roleId);
  if (!role) {
    return null;
  }

  const after = bitsOf([...NON_DANGEROUS_PERMISSIONS, ...usedPermissions]);

  return {
    kind: "set_role_permissions",
    roleId,
    before: role.permissions,
    after,
    affectedMembers: role.holderCount,
    channelLosses: channelLosses(guild, roleId, after),
  };
}

/**
 * Administrator ignores overrides; without it, a deny on @everyone or on the
 * role itself takes effect, and the role's own allow beats an @everyone deny.
 * Allows from the holders' other roles aren't considered.
 */
function channelLosses(
  guild: GuildSnapshot,
  roleId: string,
  after: bigint,
): ChannelLoss[] {
  const byChannel = new Map<
    string,
    { everyoneDeny: bigint; roleAllow: bigint; roleDeny: bigint }
  >();

  for (const overwrite of guild.overwrites) {
    if (overwrite.targetType !== "role") {
      continue;
    }

    const isRole = overwrite.targetId === roleId;
    const isEveryone = overwrite.targetId === guild.everyoneRoleId;
    if (!isRole && !isEveryone) {
      continue;
    }

    const entry = byChannel.get(overwrite.channelId) ?? {
      everyoneDeny: 0n,
      roleAllow: 0n,
      roleDeny: 0n,
    };
    if (isRole) {
      entry.roleAllow = overwrite.allow;
      entry.roleDeny = overwrite.deny;
    } else {
      entry.everyoneDeny = overwrite.deny;
    }
    byChannel.set(overwrite.channelId, entry);
  }

  const losses: ChannelLoss[] = [];
  for (const [channelId, { everyoneDeny, roleAllow, roleDeny }] of byChannel) {
    const denied = (everyoneDeny & ~roleAllow) | roleDeny;
    const lost = permissionsIn(after & denied, ALL_PERMISSIONS);
    if (lost.length > 0) {
      losses.push({ channelId, permissions: lost });
    }
  }

  return losses;
}

function findOverwrite(
  guild: GuildSnapshot,
  channelId: string,
  targetId: string,
) {
  return guild.overwrites.find(
    (o) => o.channelId === channelId && o.targetId === targetId,
  );
}

function bitsOf(permissions: readonly PermissionName[]): bigint {
  return permissions.reduce((acc, p) => acc | PermissionFlagsBits[p], 0n);
}
