import { asc, desc, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { scamImageHashesInAppPublic } from "@/infrastructure/database/schema";
import { toSignedBigint, toUnsignedBigint } from "../utils/bigintUtils";
import type {
  ScamImageHash,
  ScamImageHashRepository,
} from "../domain/repositories/ScamImageHashRepository";

import type * as schema from "@/infrastructure/database/schema";

export class DrizzleScamImageHashRepository implements ScamImageHashRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findMatch(
    hashValue: bigint,
    threshold: number,
  ): Promise<ScamImageHash | null> {
    const signed = toSignedBigint(hashValue);

    const rows = await this.db
      .select()
      .from(scamImageHashesInAppPublic)
      .where(
        sql`bit_count(${scamImageHashesInAppPublic.hash}::bit(64) # ${signed}::bigint::bit(64)) <= ${threshold}`,
      )
      .orderBy(
        asc(
          sql`bit_count(${scamImageHashesInAppPublic.hash}::bit(64) # ${signed}::bigint::bit(64))`,
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToEntity(rows[0]);
  }

  async add(
    hashValue: bigint,
    category?: string,
    label?: string,
  ): Promise<number> {
    const signed = toSignedBigint(hashValue);

    const rows = await this.db
      .insert(scamImageHashesInAppPublic)
      .values({
        hash: signed,
        category: category ?? null,
        label: label ?? null,
      })
      .returning({ id: scamImageHashesInAppPublic.id });

    return rows[0].id;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db
      .delete(scamImageHashesInAppPublic)
      .where(sql`${scamImageHashesInAppPublic.id} = ${id}`)
      .returning({ id: scamImageHashesInAppPublic.id });

    return rows.length > 0;
  }

  async list(): Promise<ScamImageHash[]> {
    const rows = await this.db
      .select()
      .from(scamImageHashesInAppPublic)
      .orderBy(desc(scamImageHashesInAppPublic.addedAt));

    return rows.map((row) => this.rowToEntity(row));
  }

  private rowToEntity(row: {
    id: number;
    hash: bigint;
    category: string | null;
    label: string | null;
    addedAt: Date;
  }): ScamImageHash {
    return {
      id: row.id,
      hash: toUnsignedBigint(row.hash),
      category: row.category,
      label: row.label,
      addedAt: row.addedAt,
    };
  }
}
