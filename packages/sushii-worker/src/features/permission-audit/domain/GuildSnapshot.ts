import type { PermissionName } from "./PermissionUsage";

export interface RoleSnapshot {
  id: string;
  name: string;
  position: number;
  permissions: bigint;
  /** Set for a bot's managed integration role. */
  botUserId: string | null;
  createdAt: Date;
  holderIds: readonly string[];
}

export interface OverwriteSnapshot {
  channelId: string;
  channelName: string;
  targetId: string;
  targetType: "role" | "member";
  allow: bigint;
}

export interface MemberSnapshot {
  id: string;
  username: string;
  isBot: boolean;
  roleIds: readonly string[];
  joinedAt: Date | null;
  lastActiveAt: Date | null;
}

export interface SelfAssignableRole {
  roleId: string;
  /** Where members can take it from, e.g. "role menu Pick roles" or "level 10 reward". */
  source: string;
  /** True when a role menu requires another role first. */
  restricted: boolean;
}

export interface GuildSnapshot {
  guildId: string;
  ownerId: string;
  everyoneRoleId: string;
  mfaRequired: boolean;
  roles: readonly RoleSnapshot[];
  overwrites: readonly OverwriteSnapshot[];
  members: ReadonlyMap<string, MemberSnapshot>;
  memberCacheComplete: boolean;
  selfAssignable: readonly SelfAssignableRole[];
  now: Date;
}

export interface UsageSnapshot {
  /** userId → permission → last used, from any source. */
  lastUsed: ReadonlyMap<string, ReadonlyMap<PermissionName, Date>>;
  /** Audit log usage only: the evidence that a bot performed an action. */
  auditLogLastUsed: ReadonlyMap<string, ReadonlyMap<PermissionName, Date>>;
  /** Start of reliable history per tracked permission. Untracked permissions are absent. */
  observedSince: ReadonlyMap<PermissionName, Date>;
  backfillPending: boolean;
}
