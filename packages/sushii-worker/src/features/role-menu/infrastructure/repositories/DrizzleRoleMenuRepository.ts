import { and, eq, ilike } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { None, type Option, Some } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import {
  roleMenuMessagesInAppPublic,
  roleMenuRolesInAppPublic,
  roleMenusInAppPublic,
} from "@/infrastructure/database/schema";

import type {
  CreateRoleMenuRequest,
  RoleMenu,
  UpdateRoleMenuRequest,
} from "../../domain/entities/RoleMenu";
import type {
  CreateRoleMenuMessageRequest,
  RoleMenuMessage,
} from "../../domain/entities/RoleMenuMessage";
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
      id: menu.id,
      guildId: menu.guildId.toString(),
      menuName: menu.menuName,
      description: menu.description || undefined,
      maxCount: menu.maxCount || undefined,
      requiredRole: menu.requiredRole?.toString(),
    });
  }

  async findById(id: number): Promise<Option<RoleMenu>> {
    this.logger.debug({ id }, "Finding role menu by ID");

    const result = await this.db
      .select()
      .from(roleMenusInAppPublic)
      .where(eq(roleMenusInAppPublic.id, id));

    if (result.length === 0) {
      return None;
    }

    const menu = result[0];
    return Some({
      id: menu.id,
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
      id: menu.id,
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
      id: menu.id,
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

  async setRoles(
    guildId: string,
    menuName: string,
    roleIds: string[],
  ): Promise<void> {
    this.logger.debug({ guildId, menuName, roleIds }, "Setting roles for menu");

    await this.db.transaction(async (trx) => {
      // Delete all existing roles for this menu
      await trx
        .delete(roleMenuRolesInAppPublic)
        .where(
          and(
            eq(roleMenuRolesInAppPublic.guildId, BigInt(guildId)),
            eq(roleMenuRolesInAppPublic.menuName, menuName),
          ),
        );

      // Insert new roles if any provided
      if (roleIds.length > 0) {
        const values = roleIds.map((roleId, index) => ({
          guildId: BigInt(guildId),
          menuName,
          roleId: BigInt(roleId),
          position: index + 1,
        }));

        await trx.insert(roleMenuRolesInAppPublic).values(values);
      }
    });
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

  // Message tracking methods
  async trackMessage(request: CreateRoleMenuMessageRequest): Promise<void> {
    this.logger.debug(
      {
        guildId: request.guildId,
        menuName: request.menuName,
        messageId: request.messageId,
      },
      "Tracking role menu message",
    );

    await this.db.insert(roleMenuMessagesInAppPublic).values({
      guildId: BigInt(request.guildId),
      menuName: request.menuName,
      channelId: BigInt(request.channelId),
      messageId: BigInt(request.messageId),
    });
  }

  async getActiveMessages(
    guildId: string,
    menuName: string,
  ): Promise<RoleMenuMessage[]> {
    this.logger.debug(
      { guildId, menuName },
      "Getting active messages for menu",
    );

    const results = await this.db
      .select()
      .from(roleMenuMessagesInAppPublic)
      .where(
        and(
          eq(roleMenuMessagesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuMessagesInAppPublic.menuName, menuName),
        ),
      )
      .orderBy(roleMenuMessagesInAppPublic.createdAt);

    return results.map((message) => ({
      guildId: message.guildId.toString(),
      menuName: message.menuName,
      channelId: message.channelId.toString(),
      messageId: message.messageId.toString(),
      createdAt: new Date(message.createdAt),
      needsUpdate: message.needsUpdate,
    }));
  }

  async countActiveMessages(
    guildId: string,
    menuName: string,
  ): Promise<number> {
    this.logger.debug(
      { guildId, menuName },
      "Counting active messages for menu",
    );

    const result = await this.db
      .select()
      .from(roleMenuMessagesInAppPublic)
      .where(
        and(
          eq(roleMenuMessagesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuMessagesInAppPublic.menuName, menuName),
        ),
      );

    return result.length;
  }

  async markMessagesNeedUpdate(
    guildId: string,
    menuName: string,
  ): Promise<void> {
    this.logger.debug(
      { guildId, menuName },
      "Marking messages as needing update",
    );

    await this.db
      .update(roleMenuMessagesInAppPublic)
      .set({ needsUpdate: true })
      .where(
        and(
          eq(roleMenuMessagesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuMessagesInAppPublic.menuName, menuName),
        ),
      );
  }

  async markMessagesUpdated(guildId: string, menuName: string): Promise<void> {
    this.logger.debug(
      { guildId, menuName },
      "Marking messages as updated (clearing needs update flag)",
    );

    await this.db
      .update(roleMenuMessagesInAppPublic)
      .set({ needsUpdate: false })
      .where(
        and(
          eq(roleMenuMessagesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuMessagesInAppPublic.menuName, menuName),
        ),
      );
  }

  async deleteMessage(
    guildId: string,
    menuName: string,
    messageId: string,
  ): Promise<void> {
    this.logger.debug(
      { guildId, menuName, messageId },
      "Deleting tracked message",
    );

    await this.db
      .delete(roleMenuMessagesInAppPublic)
      .where(
        and(
          eq(roleMenuMessagesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuMessagesInAppPublic.menuName, menuName),
          eq(roleMenuMessagesInAppPublic.messageId, BigInt(messageId)),
        ),
      );
  }

  async deleteAllMessages(guildId: string, menuName: string): Promise<void> {
    this.logger.debug({ guildId, menuName }, "Deleting all tracked messages");

    await this.db
      .delete(roleMenuMessagesInAppPublic)
      .where(
        and(
          eq(roleMenuMessagesInAppPublic.guildId, BigInt(guildId)),
          eq(roleMenuMessagesInAppPublic.menuName, menuName),
        ),
      );
  }
}
