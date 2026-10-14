import type { SelfAssignableRole } from "./GuildSnapshot";
import type { PermissionName, PermissionUsageSource } from "./PermissionUsage";

export interface UsageRow {
  userId: string;
  permission: PermissionName;
  source: PermissionUsageSource;
  lastUsedAt: Date;
}

export interface PermissionAuditReadRepository {
  listUsage(guildId: string): Promise<UsageRow[]>;
  lastActiveAt(
    guildId: string,
    userIds: readonly string[],
  ): Promise<Map<string, Date>>;
  listSelfAssignableRoles(guildId: string): Promise<SelfAssignableRole[]>;
}
