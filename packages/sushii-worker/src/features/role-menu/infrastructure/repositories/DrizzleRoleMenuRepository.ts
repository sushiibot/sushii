import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { None, type Option, Some } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import {
  roleMenuRolesInAppPublic,
  roleMenusInAppPublic,
} from "@/infrastructure/database/schema";

import type {
  CreateRoleMenuRequest,
  RoleMenu,
  UpdateRoleMenuRequest,
} from "../../domain/entities/RoleMenu";
import type {
  RoleMenuRole,
  UpdateRoleMenuRoleRequest,
} from "../../domain/entities/RoleMenuRole";
import type { RoleMenuRepository } from "../../domain/repositories/RoleMenuRepository";

export class DrizzleRoleMenuRepository implements RoleMenuRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async create(request: CreateRoleMenuRequest): Promise<void> {
    this.logger.debug(
      { guildId: request.guildId, menuName: request.menuName },
      "Creating role menu",
    );

    await this.db.insert(roleMenusInAppPublic).values({
      guildId: BigInt(request.guildId),
      menuName: request.menuName,
      description: request.description,
      maxCount: request.maxCount,
      requiredRole: request.requiredRole
        ? BigInt(request.requiredRole)
        : undefined,
    });
  }

  async findByName(
    guildId: string,
    menuName: string,
  ): Promise<Option<RoleMenu>> {
    this.logger.debug({ guildId, menuName }, "Finding role menu by name");

    const result = await this.db
      .select()
      .from(roleMenusInAppPublic)
      .where(
        and(
          eq(roleMenusInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenusInAppPublic.menuName, menuName),
        ),
      );

    if (result.length === 0) {
      return None;
    }

    const menu = result[0];
    return Some({
      guildId: menu.guildId.toString(),
      menuName: menu.menuName,
      description: menu.description || undefined,
      maxCount: menu.maxCount || undefined,
      requiredRole: menu.requiredRole?.toString(),
    });
  }

  async findByGuild(guildId: string): Promise<RoleMenu[]> {
    this.logger.debug({ guildId }, "Finding role menus by guild");

    const results = await this.db
      .select()
      .from(roleMenusInAppPublic)
      .where(eq(roleMenusInAppPublic.guildId, BigInt(guildId)));

    return results.map((menu) => ({
      guildId: menu.guildId.toString(),
      menuName: menu.menuName,
      description: menu.description || undefined,
      maxCount: menu.maxCount || undefined,
      requiredRole: menu.requiredRole?.toString(),
    }));
  }

  async search(guildId: string, query: string): Promise<RoleMenu[]> {
    this.logger.debug({ guildId, query }, "Searching role menus");

    const results = await this.db
      .select()
      .from(roleMenusInAppPublic)
      .where(
        and(
          eq(roleMenusInAppPublic.guildId, BigInt(guildId)),
          ilike(roleMenusInAppPublic.menuName, `${query}%`),
        ),
      );

    return results.map((menu) => ({
      guildId: menu.guildId.toString(),
      menuName: menu.menuName,
      description: menu.description || undefined,
      maxCount: menu.maxCount || undefined,
      requiredRole: menu.requiredRole?.toString(),
    }));
  }

  async update(request: UpdateRoleMenuRequest): Promise<void> {
    this.logger.debug(
      {
        guildId: request.guildId,
        menuName: request.menuName,
        newMenuName: request.newMenuName,
      },
      "Updating role menu",
    );

    const updateValues: Partial<typeof roleMenusInAppPublic.$inferInsert> = {};

    if (request.newMenuName !== undefined) {
      updateValues.menuName = request.newMenuName;
    }
    if (request.description !== undefined) {
      updateValues.description = request.description;
    }
    if (request.maxCount !== undefined) {
      updateValues.maxCount = request.maxCount;
    }
    if (request.requiredRole !== undefined) {
      updateValues.requiredRole = request.requiredRole
        ? BigInt(request.requiredRole)
        : null;
    }

    await this.db
      .update(roleMenusInAppPublic)
      .set(updateValues)
      .where(
        and(
          eq(roleMenusInAppPublic.guildId, BigInt(request.guildId)),
          eq(roleMenusInAppPublic.menuName, request.menuName),
        ),
      );
  }

  async delete(guildId: string, menuName: string): Promise<void> {
    this.logger.debug({ guildId, menuName }, "Deleting role menu");

    await this.db
      .delete(roleMenusInAppPublic)
      .where(
        and(
          eq(roleMenusInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenusInAppPublic.menuName, menuName),
        ),
      );
  }

  async addRoles(
    guildId: string,
    menuName: string,
    roleIds: string[],
  ): Promise<void> {
    if (roleIds.length === 0) {
      return;
    }

    this.logger.debug({ guildId, menuName, roleIds }, "Adding roles to menu");

    await this.db.transaction(async (trx) => {
      // Get the max position of existing roles
      const maxPositionResult = await trx
        .select({
          maxPosition: roleMenuRolesInAppPublic.position,
        })
        .from(roleMenuRolesInAppPublic)
        .where(
          and(
            eq(roleMenuRolesInAppPublic.guildId, BigInt(guildId)),
            eq(roleMenuRolesInAppPublic.menuName, menuName),
          ),
        )
        .orderBy(roleMenuRolesInAppPublic.position);

      let startPosition = 1;
      if (maxPositionResult.length > 0) {
        const lastPosition =
          maxPositionResult[maxPositionResult.length - 1]?.maxPosition;
        if (lastPosition) {
          startPosition = lastPosition + 1;
        }
      }

      // Create values for bulk insert
      const values = roleIds.map((roleId, index) => ({
        guildId: BigInt(guildId),
        menuName,
        roleId: BigInt(roleId),
        position: startPosition + index,
      }));

      // Insert roles, ignoring conflicts (roles already in menu)
      await trx
        .insert(roleMenuRolesInAppPublic)
        .values(values)
        .onConflictDoNothing();
    });
  }

  async removeRoles(
    guildId: string,
    menuName: string,
    roleIds: string[],
  ): Promise<void> {
    if (roleIds.length === 0) {
      return;
    }

    this.logger.debug(
      { guildId, menuName, roleIds },
      "Removing roles from menu",
    );

    const bigIntRoleIds = roleIds.map((id) => BigInt(id));

    await this.db
      .delete(roleMenuRolesInAppPublic)
      .where(
        and(
          eq(roleMenuRolesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuRolesInAppPublic.menuName, menuName),
          inArray(roleMenuRolesInAppPublic.roleId, bigIntRoleIds),
        ),
      );
  }

  async findRolesByMenu(
    guildId: string,
    menuName: string,
  ): Promise<RoleMenuRole[]> {
    this.logger.debug({ guildId, menuName }, "Finding roles by menu");

    const results = await this.db
      .select()
      .from(roleMenuRolesInAppPublic)
      .where(
        and(
          eq(roleMenuRolesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuRolesInAppPublic.menuName, menuName),
        ),
      )
      .orderBy(roleMenuRolesInAppPublic.position);

    return results.map((role) => ({
      guildId: role.guildId.toString(),
      menuName: role.menuName,
      roleId: role.roleId.toString(),
      emoji: role.emoji || undefined,
      description: role.description || undefined,
      position: role.position || undefined,
    }));
  }

  async findRole(
    guildId: string,
    menuName: string,
    roleId: string,
  ): Promise<Option<RoleMenuRole>> {
    this.logger.debug({ guildId, menuName, roleId }, "Finding role in menu");

    const result = await this.db
      .select()
      .from(roleMenuRolesInAppPublic)
      .where(
        and(
          eq(roleMenuRolesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuRolesInAppPublic.menuName, menuName),
          eq(roleMenuRolesInAppPublic.roleId, BigInt(roleId)),
        ),
      );

    if (result.length === 0) {
      return None;
    }

    const role = result[0];
    return Some({
      guildId: role.guildId.toString(),
      menuName: role.menuName,
      roleId: role.roleId.toString(),
      emoji: role.emoji || undefined,
      description: role.description || undefined,
      position: role.position || undefined,
    });
  }

  async updateRole(request: UpdateRoleMenuRoleRequest): Promise<void> {
    this.logger.debug(
      {
        guildId: request.guildId,
        menuName: request.menuName,
        roleId: request.roleId,
      },
      "Updating role in menu",
    );

    const updateValues: Partial<typeof roleMenuRolesInAppPublic.$inferInsert> =
      {};

    if (request.emoji !== undefined) {
      updateValues.emoji = request.emoji;
    }
    if (request.description !== undefined) {
      updateValues.description = request.description;
    }

    await this.db
      .update(roleMenuRolesInAppPublic)
      .set(updateValues)
      .where(
        and(
          eq(roleMenuRolesInAppPublic.guildId, BigInt(request.guildId)),
          eq(roleMenuRolesInAppPublic.menuName, request.menuName),
          eq(roleMenuRolesInAppPublic.roleId, BigInt(request.roleId)),
        ),
      );
  }

  async reorderRoles(
    guildId: string,
    menuName: string,
    roleIds: string[],
  ): Promise<void> {
    this.logger.debug(
      { guildId, menuName, roleIds },
      "Reordering roles in menu",
    );

    await this.db.transaction(async (trx) => {
      // Get current roles to validate input
      const currentRoles = await trx
        .select()
        .from(roleMenuRolesInAppPublic)
        .where(
          and(
            eq(roleMenuRolesInAppPublic.guildId, BigInt(guildId)),
            eq(roleMenuRolesInAppPublic.menuName, menuName),
          ),
        );

      const currentRoleIds = currentRoles.map((role) => role.roleId.toString());

      // Validate that supplied roleIds matches current roles
      if (currentRoleIds.length !== roleIds.length) {
        throw new Error("Mismatched supplied roleIds");
      }

      const roleIdsSet = new Set(roleIds);
      for (const roleId of currentRoleIds) {
        if (!roleIdsSet.has(roleId)) {
          throw new Error("Mismatched supplied roleIds");
        }
      }

      // Generate new position mappings
      const positionMap = new Map<string, number>();
      for (let i = 0; i < roleIds.length; i++) {
        positionMap.set(roleIds[i], i + 1);
      }

      // Create updated values for bulk upsert
      const updatedValues = currentRoles.map((role) => ({
        guildId: role.guildId,
        menuName: role.menuName,
        roleId: role.roleId,
        emoji: role.emoji,
        description: role.description,
        position: positionMap.get(role.roleId.toString()) || role.position,
      }));

      // Bulk update using upsert pattern for better performance
      await trx
        .insert(roleMenuRolesInAppPublic)
        .values(updatedValues)
        .onConflictDoUpdate({
          target: [
            roleMenuRolesInAppPublic.guildId,
            roleMenuRolesInAppPublic.menuName,
            roleMenuRolesInAppPublic.roleId,
          ],
          set: {
            position: sql`excluded.position`,
          },
        });
    });
  }
}
