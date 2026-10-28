import { and, asc, count, countDistinct, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import { reasonTemplatesInAppPublic } from "@/infrastructure/database/schema";

import type { ReasonTemplate } from "../domain/ReasonTemplate";
import type {
  CreateReasonTemplateInput,
  ReasonTemplateConflict,
  ReasonTemplateRepository,
  UpdateReasonTemplateInput,
} from "../domain/ReasonTemplateRepository";

const UNIQUE_VIOLATION = "23505";
const SHORTCUT_CONSTRAINT = "reason_templates_guild_id_shortcut_key";
const CONTENT_KEY_CONSTRAINT = "reason_templates_guild_id_content_key_key";

type DbType = NodePgDatabase<typeof schema>;
type ReasonTemplateRow = typeof reasonTemplatesInAppPublic.$inferSelect;

const table = reasonTemplatesInAppPublic;

function toBigIntId(id: string): bigint | null {
  return /^\d{1,18}$/.test(id) ? BigInt(id) : null;
}

function errorField(err: unknown, field: "code" | "constraint"): unknown {
  return typeof err === "object" && err !== null && field in err
    ? (err as Record<string, unknown>)[field]
    : undefined;
}

// Drizzle wraps driver errors, so the pg error may sit in `cause`.
function uniqueConflict(err: unknown): ReasonTemplateConflict | null {
  const candidates = [
    err,
    typeof err === "object" && err !== null && "cause" in err
      ? err.cause
      : undefined,
  ];

  for (const candidate of candidates) {
    if (errorField(candidate, "code") !== UNIQUE_VIOLATION) {
      continue;
    }

    const constraint = errorField(candidate, "constraint");
    if (constraint === SHORTCUT_CONSTRAINT) {
      return "shortcut_taken";
    }

    if (constraint === CONTENT_KEY_CONSTRAINT) {
      return "duplicate";
    }
  }

  return null;
}

function toEntity(row: ReasonTemplateRow): ReasonTemplate {
  return {
    id: row.id.toString(),
    guildId: row.guildId.toString(),
    shortcut: row.shortcut,
    content: row.content,
    contentKey: row.contentKey,
    createdBy: row.createdBy.toString(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
  };
}

export class DrizzleReasonTemplateRepository
  implements ReasonTemplateRepository
{
  constructor(private readonly db: DbType) {}

  async listByGuild(
    guildId: string,
    page: { limit: number; offset: number },
  ): Promise<ReasonTemplate[]> {
    const rows = await this.db
      .select()
      .from(table)
      .where(eq(table.guildId, BigInt(guildId)))
      .orderBy(desc(table.useCount), asc(table.id))
      .limit(page.limit)
      .offset(page.offset);

    return rows.map(toEntity);
  }

  async listAllByGuild(guildId: string): Promise<ReasonTemplate[]> {
    const rows = await this.db
      .select()
      .from(table)
      .where(eq(table.guildId, BigInt(guildId)))
      .orderBy(desc(table.useCount), asc(table.id));

    return rows.map(toEntity);
  }

  async countByGuild(guildId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(table)
      .where(eq(table.guildId, BigInt(guildId)));

    return row?.count ?? 0;
  }

  async findById(guildId: string, id: string): Promise<ReasonTemplate | null> {
    const templateId = toBigIntId(id);
    if (templateId === null) {
      return null;
    }

    const [row] = await this.db
      .select()
      .from(table)
      .where(and(eq(table.guildId, BigInt(guildId)), eq(table.id, templateId)))
      .limit(1);

    return row ? toEntity(row) : null;
  }

  async findByShortcut(
    guildId: string,
    shortcut: string,
  ): Promise<ReasonTemplate | null> {
    const [row] = await this.db
      .select()
      .from(table)
      .where(
        and(eq(table.guildId, BigInt(guildId)), eq(table.shortcut, shortcut)),
      )
      .limit(1);

    return row ? toEntity(row) : null;
  }

  async findByContentKey(
    guildId: string,
    contentKey: string,
  ): Promise<ReasonTemplate | null> {
    const [row] = await this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.guildId, BigInt(guildId)),
          eq(table.contentKey, contentKey),
        ),
      )
      .limit(1);

    return row ? toEntity(row) : null;
  }

  async create(
    input: CreateReasonTemplateInput,
  ): Promise<Result<ReasonTemplate, ReasonTemplateConflict>> {
    try {
      const [row] = await this.db
        .insert(table)
        .values({
          guildId: BigInt(input.guildId),
          shortcut: input.shortcut,
          content: input.content,
          contentKey: input.contentKey,
          createdBy: BigInt(input.createdBy),
        })
        .returning();

      if (!row) {
        throw new Error("Reason template insert returned no rows");
      }

      return Ok(toEntity(row));
    } catch (err) {
      const conflict = uniqueConflict(err);
      if (conflict) {
        return Err(conflict);
      }

      throw err;
    }
  }

  async update(
    guildId: string,
    id: string,
    input: UpdateReasonTemplateInput,
  ): Promise<Result<ReasonTemplate, "not_found" | ReasonTemplateConflict>> {
    const templateId = toBigIntId(id);
    if (templateId === null) {
      return Err("not_found");
    }

    try {
      const [row] = await this.db
        .update(table)
        .set({
          shortcut: input.shortcut,
          content: input.content,
          contentKey: input.contentKey,
          updatedAt: new Date(),
        })
        .where(
          and(eq(table.guildId, BigInt(guildId)), eq(table.id, templateId)),
        )
        .returning();

      return row ? Ok(toEntity(row)) : Err("not_found");
    } catch (err) {
      const conflict = uniqueConflict(err);
      if (conflict) {
        return Err(conflict);
      }

      throw err;
    }
  }

  async delete(guildId: string, id: string): Promise<boolean> {
    const templateId = toBigIntId(id);
    if (templateId === null) {
      return false;
    }

    const rows = await this.db
      .delete(table)
      .where(and(eq(table.guildId, BigInt(guildId)), eq(table.id, templateId)))
      .returning({ id: table.id });

    return rows.length > 0;
  }

  async recordUse(guildId: string, id: string): Promise<void> {
    const templateId = toBigIntId(id);
    if (templateId === null) {
      return;
    }

    await this.db
      .update(table)
      .set({
        useCount: sql`${table.useCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(and(eq(table.guildId, BigInt(guildId)), eq(table.id, templateId)));
  }

  async countStats(): Promise<{ guilds: number; total: number }> {
    const [row] = await this.db
      .select({ guilds: countDistinct(table.guildId), total: count() })
      .from(table);

    return { guilds: row?.guilds ?? 0, total: row?.total ?? 0 };
  }
}
