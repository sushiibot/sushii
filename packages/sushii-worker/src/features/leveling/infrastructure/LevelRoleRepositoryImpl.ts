import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { levelRolesInAppPublic } from "@/infrastructure/database/schema";

import { LevelRole } from "../domain/entities/LevelRole";
import type { LevelRoleRepository } from "../domain/repositories/LevelRoleRepository";

export class LevelRoleRepositoryImpl implements LevelRoleRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  private safeBigIntToNumber(value: bigint | null, fieldName: string): number | null {
    if (value === null) return null;
    
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${fieldName} value too large: ${value}`);
    }
    
    return Number(value);
  }

  async findByGuild(guildId: string): Promise<LevelRole[]> {
    const result = await this.db
      .select()
      .from(levelRolesInAppPublic)
      .where(eq(levelRolesInAppPublic.guildId, BigInt(guildId)));

    return result.map(
      (record) =>
        LevelRole.reconstitute(
          guildId,
          record.roleId.toString(),
          this.safeBigIntToNumber(record.addLevel, 'addLevel'),
          this.safeBigIntToNumber(record.removeLevel, 'removeLevel'),
        ),
    );
  }

  async findByGuildAndRole(
    guildId: string,
    roleId: string,
  ): Promise<LevelRole | null> {
    const result = await this.db
      .select()
      .from(levelRolesInAppPublic)
      .where(
        and(
          eq(levelRolesInAppPublic.guildId, BigInt(guildId)),
          eq(levelRolesInAppPublic.roleId, BigInt(roleId)),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const record = result[0];
    return LevelRole.reconstitute(
      guildId,
      record.roleId.toString(),
      this.safeBigIntToNumber(record.addLevel, 'addLevel'),
      this.safeBigIntToNumber(record.removeLevel, 'removeLevel'),
    );
  }

  async save(levelRole: LevelRole): Promise<void> {
    const addLevel = levelRole.getAddLevel();
    const removeLevel = levelRole.getRemoveLevel();

    await this.db
      .insert(levelRolesInAppPublic)
      .values({
        guildId: BigInt(levelRole.getGuildId()),
        roleId: BigInt(levelRole.getRoleId()),
        addLevel: addLevel !== null ? BigInt(addLevel) : null,
        removeLevel: removeLevel !== null ? BigInt(removeLevel) : null,
      })
      .onConflictDoUpdate({
        target: [levelRolesInAppPublic.guildId, levelRolesInAppPublic.roleId],
        set: {
          addLevel: addLevel !== null ? BigInt(addLevel) : null,
          removeLevel: removeLevel !== null ? BigInt(removeLevel) : null,
        },
      });
  }

  async deleteByGuildAndRole(
    guildId: string,
    roleId: string,
  ): Promise<boolean> {
    const result = await this.db
      .delete(levelRolesInAppPublic)
      .where(
        and(
          eq(levelRolesInAppPublic.guildId, BigInt(guildId)),
          eq(levelRolesInAppPublic.roleId, BigInt(roleId)),
        ),
      );

    return result.rowCount !== null && result.rowCount > 0;
  }
}
