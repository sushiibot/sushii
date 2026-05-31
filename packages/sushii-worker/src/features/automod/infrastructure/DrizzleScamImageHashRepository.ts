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

  async findClosest(
    hashValue: bigint,
  ): Promise<{ entry: ScamImageHash; distance: number } | null> {
    const signed = toSignedBigint(hashValue);
    const distanceExpr = sql<number>`bit_count(${scamImageHashesInAppPublic.hash}::bit(64) # ${signed}::bigint::bit(64))`;

    const rows = await this.db
      .select({
        id: scamImageHashesInAppPublic.id,
        hash: scamImageHashesInAppPublic.hash,
        label: scamImageHashesInAppPublic.label,
        addedAt: scamImageHashesInAppPublic.addedAt,
        distance: distanceExpr,
      })
      .from(scamImageHashesInAppPublic)
      .orderBy(asc(distanceExpr))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return { entry: this.rowToEntity(rows[0]), distance: rows[0].distance };
  }

  async add(hashValue: bigint, label?: string): Promise<number> {
    const signed = toSignedBigint(hashValue);

    const rows = await this.db
      .insert(scamImageHashesInAppPublic)
      .values({
        hash: signed,
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
    label: string | null;
    addedAt: Date;
  }): ScamImageHash {
    return {
      id: row.id,
      hash: toUnsignedBigint(row.hash),
      label: row.label,
      addedAt: row.addedAt,
    };
  }
}
