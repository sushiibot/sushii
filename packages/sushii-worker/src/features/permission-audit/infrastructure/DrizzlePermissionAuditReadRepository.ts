import { and, eq, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  levelRolesInAppPublic,
  permissionUsageInAppPublic,
  roleMenuRolesInAppPublic,
  roleMenusInAppPublic,
} from "@/infrastructure/database/schema";

import type { SelfAssignableRole } from "../domain/GuildSnapshot";
import type {
  PermissionAuditReadRepository,
  UsageRow,
} from "../domain/PermissionAuditReadRepository";
import type {
  PermissionName,
  PermissionUsageSource,
} from "../domain/PermissionUsage";

export class DrizzlePermissionAuditReadRepository
  implements PermissionAuditReadRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listUsage(guildId: string): Promise<UsageRow[]> {
    const table = permissionUsageInAppPublic;
    const rows = await this.db
      .select({
        userId: table.userId,
        permission: table.permission,
        source: table.source,
        lastUsedAt: table.lastUsedAt,
      })
      .from(table)
      .where(eq(table.guildId, BigInt(guildId)));

    return rows.map((row) => ({
      userId: row.userId.toString(),
      permission: row.permission as PermissionName,
      source: row.source as PermissionUsageSource,
      lastUsedAt: row.lastUsedAt,
    }));
  }

  async listSelfAssignableRoles(
    guildId: string,
  ): Promise<SelfAssignableRole[]> {
    const id = BigInt(guildId);

    const menuRoles = await this.db
      .select({
        roleId: roleMenuRolesInAppPublic.roleId,
        menuName: roleMenuRolesInAppPublic.menuName,
        requiredRole: roleMenusInAppPublic.requiredRole,
      })
      .from(roleMenuRolesInAppPublic)
      .innerJoin(
        roleMenusInAppPublic,
        and(
          eq(roleMenusInAppPublic.guildId, roleMenuRolesInAppPublic.guildId),
          eq(roleMenusInAppPublic.menuName, roleMenuRolesInAppPublic.menuName),
        ),
      )
      .where(eq(roleMenuRolesInAppPublic.guildId, id));

    const levelRoles = await this.db
      .select({
        roleId: levelRolesInAppPublic.roleId,
        addLevel: levelRolesInAppPublic.addLevel,
      })
      .from(levelRolesInAppPublic)
      .where(
        and(
          eq(levelRolesInAppPublic.guildId, id),
          isNotNull(levelRolesInAppPublic.addLevel),
        ),
      );

    return [
      ...menuRoles.map((row) => ({
        roleId: row.roleId.toString(),
        source: `role menu ${row.menuName}`,
        restricted: row.requiredRole != null,
      })),
      ...levelRoles.map((row) => ({
        roleId: row.roleId.toString(),
        source: `level ${row.addLevel} reward`,
        restricted: false,
      })),
    ];
  }
}
