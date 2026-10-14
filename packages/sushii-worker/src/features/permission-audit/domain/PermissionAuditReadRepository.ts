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
  listSelfAssignableRoles(guildId: string): Promise<SelfAssignableRole[]>;
}
