import { and, count, desc, eq, ilike, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";

import type { TagData } from "../domain/entities/Tag";
import { Tag } from "../domain/entities/Tag";
import type { TagRepository } from "../domain/repositories/TagRepository";
import type { TagFilters } from "../domain/value-objects/TagFilters";
import type { TagName } from "../domain/value-objects/TagName";

type DbType = NodePgDatabase<typeof schema>;

export class DrizzleTagRepository implements TagRepository {
  constructor(
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  async save(tag: Tag): Promise<void> {
    const tagData = tag.toData();

    await this.db
      .insert(schema.tagsInAppPublic)
      .values({
        tagName: tagData.name,
        content: tagData.content || "",
        attachment: tagData.attachment,
        guildId: BigInt(tagData.guildId),
        ownerId: BigInt(tagData.ownerId),
        useCount: tagData.useCount,
        created: tagData.created,
      })
      .onConflictDoUpdate({
        target: [
          schema.tagsInAppPublic.guildId,
          schema.tagsInAppPublic.tagName,
        ],
        set: {
          content: tagData.content || "",
          attachment: tagData.attachment,
          useCount: tagData.useCount,
        },
      });

    this.logger.debug({ tagName: tagData.name }, "Tag saved to database");
  }

  async findByNameAndGuild(
    name: TagName,
    guildId: string,
  ): Promise<Tag | null> {
    const result = await this.db
      .select()
      .from(schema.tagsInAppPublic)
      .where(
        and(
          eq(schema.tagsInAppPublic.guildId, BigInt(guildId)),
          eq(schema.tagsInAppPublic.tagName, name.getValue()),
        ),
      )
      .limit(1);

    return result.length > 0 ? this.mapToTag(result[0]) : null;
  }

  async findByFilters(filters: TagFilters, limit: number): Promise<Tag[]> {
    const conditions = [
      eq(schema.tagsInAppPublic.guildId, BigInt(filters.getGuildId())),
    ];

    if (filters.getStartsWith()) {
      conditions.push(
        ilike(schema.tagsInAppPublic.tagName, `${filters.getStartsWith()}%`),
      );
    } else if (filters.getContains()) {
      // Escape any special characters in the contains filter
      conditions.push(
        ilike(schema.tagsInAppPublic.tagName, `%${filters.getContains()}%`),
      );
    }

    const ownerId = filters.getOwnerId();
    if (ownerId) {
      conditions.push(eq(schema.tagsInAppPublic.ownerId, BigInt(ownerId)));
    }

    const results = await this.db
      .select()
      .from(schema.tagsInAppPublic)
      .where(and(...conditions))
      .orderBy(desc(schema.tagsInAppPublic.tagName))
      .limit(limit);

    return results.map((row) => this.mapToTag(row));
  }

  async findRandomByFilters(filters: TagFilters): Promise<Tag | null> {
    const conditions = [
      eq(schema.tagsInAppPublic.guildId, BigInt(filters.getGuildId())),
    ];

    if (filters.getStartsWith()) {
      conditions.push(
        ilike(schema.tagsInAppPublic.tagName, `${filters.getStartsWith()}%`),
      );
    } else if (filters.getContains()) {
      conditions.push(
        ilike(schema.tagsInAppPublic.tagName, `%${filters.getContains()}%`),
      );
    }

    const ownerId = filters.getOwnerId();
    if (ownerId) {
      conditions.push(eq(schema.tagsInAppPublic.ownerId, BigInt(ownerId)));
    }

    const results = await this.db
      .select()
      .from(schema.tagsInAppPublic)
      .where(and(...conditions))
      .orderBy(sql`random()`)
      .limit(1);

    return results.length > 0 ? this.mapToTag(results[0]) : null;
  }

  async findAllByGuild(guildId: string): Promise<Tag[]> {
    const results = await this.db
      .select()
      .from(schema.tagsInAppPublic)
      .where(eq(schema.tagsInAppPublic.guildId, BigInt(guildId)))
      .orderBy(schema.tagsInAppPublic.tagName);

    return results.map((row) => this.mapToTag(row));
  }

  async findPaginatedByGuild(
    guildId: string,
    offset: number,
    limit: number,
  ): Promise<string[]> {
    const results = await this.db
      .select({ tagName: schema.tagsInAppPublic.tagName })
      .from(schema.tagsInAppPublic)
      .where(eq(schema.tagsInAppPublic.guildId, BigInt(guildId)))
      .orderBy(schema.tagsInAppPublic.tagName)
      .limit(limit)
      .offset(offset);

    return results.map((row) => row.tagName);
  }

  async countByGuild(guildId: string): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(schema.tagsInAppPublic)
      .where(eq(schema.tagsInAppPublic.guildId, BigInt(guildId)));

    return result[0]?.count || 0;
  }

  async findByAutocomplete(guildId: string, query: string): Promise<Tag[]> {
    const results = await this.db
      .select()
      .from(schema.tagsInAppPublic)
      .where(
        and(
          eq(schema.tagsInAppPublic.guildId, BigInt(guildId)),
          ilike(schema.tagsInAppPublic.tagName, `%${query}%`),
        ),
      )
      .limit(25);

    return results.map((row) => this.mapToTag(row));
  }

  async delete(name: TagName, guildId: string): Promise<Tag | null> {
    const result = await this.db
      .delete(schema.tagsInAppPublic)
      .where(
        and(
          eq(schema.tagsInAppPublic.guildId, BigInt(guildId)),
          eq(schema.tagsInAppPublic.tagName, name.getValue()),
        ),
      )
      .returning();

    return result.length > 0 ? this.mapToTag(result[0]) : null;
  }

  async deleteAllByOwner(guildId: string, ownerId: string): Promise<number> {
    const result = await this.db
      .delete(schema.tagsInAppPublic)
      .where(
        and(
          eq(schema.tagsInAppPublic.guildId, BigInt(guildId)),
          eq(schema.tagsInAppPublic.ownerId, BigInt(ownerId)),
        ),
      );

    return result.rowCount || 0;
  }

  private mapToTag(row: {
    tagName: string;
    content: string | null;
    attachment: string | null;
    guildId: bigint;
    ownerId: bigint;
    useCount: bigint;
    created: Date;
  }): Tag {
    const tagData: TagData = {
      name: row.tagName,
      content: row.content || null,
      attachment: row.attachment || null,
      guildId: row.guildId.toString(),
      ownerId: row.ownerId.toString(),
      useCount: row.useCount,
      created: row.created,
    };

    const tagResult = Tag.create(tagData);
    if (tagResult.err) {
      this.logger.error(
        { error: tagResult.val, row },
        "Failed to create tag from database row",
      );
      throw new Error(`Failed to create tag: ${tagResult.val}`);
    }

    return tagResult.val;
  }
}
