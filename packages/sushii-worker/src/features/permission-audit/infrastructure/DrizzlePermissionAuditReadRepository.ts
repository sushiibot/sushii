import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  levelRolesInAppPublic,
  permissionUsageInAppPublic,
  roleMenuRolesInAppPublic,
  roleMenusInAppPublic,
  userLevelsInAppPublic,
} from "@/infrastructure/database/schema";

import type { SelfAssignableRole } from "../domain/GuildSnapshot";
import type {
  PermissionAuditReadRepository,
  UsageRow,
} from "../domain/PermissionAuditReadRepository";
import type { PermissionName } from "../domain/PermissionUsage";

/** Keeps each IN list well under Postgres' bind parameter limit. */
const USER_ID_CHUNK_SIZE = 5000;

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
        lastUsedAt: table.lastUsedAt,
      })
      .from(table)
      .where(eq(table.guildId, BigInt(guildId)));

    return rows.map((row) => ({
      userId: row.userId.toString(),
      permission: row.permission as PermissionName,
      lastUsedAt: row.lastUsedAt,
    }));
  }

  async lastActiveAt(
    guildId: string,
    userIds: readonly string[],
  ): Promise<Map<string, Date>> {
    const table = userLevelsInAppPublic;
    const result = new Map<string, Date>();

    for (let i = 0; i < userIds.length; i += USER_ID_CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + USER_ID_CHUNK_SIZE).map(BigInt);
      const rows = await this.db
        .select({ userId: table.userId, lastMsg: table.lastMsg })
        .from(table)
        .where(
          and(eq(table.guildId, BigInt(guildId)), inArray(table.userId, chunk)),
        );

      for (const row of rows) {
        result.set(row.userId.toString(), row.lastMsg);
      }
    }

    return result;
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
