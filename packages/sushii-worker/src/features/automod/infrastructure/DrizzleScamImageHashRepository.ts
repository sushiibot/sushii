import { asc, desc, inArray, sql } from "drizzle-orm";
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

  async findById(id: number): Promise<ScamImageHash | null> {
    const rows = await this.db
      .select()
      .from(scamImageHashesInAppPublic)
      .where(sql`${scamImageHashesInAppPublic.id} = ${id}`)
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToEntity(rows[0]);
  }

  async findClosest(
    phash: bigint,
  ): Promise<{ entry: ScamImageHash; phashDistance: number } | null> {
    const signedPhash = toSignedBigint(phash);

    const phashDistanceExpr = sql<number>`COALESCE(bit_count(${scamImageHashesInAppPublic.phash}::bit(64) # ${signedPhash}::bigint::bit(64)), 64)`;

    const rows = await this.db
      .select({
        id: scamImageHashesInAppPublic.id,
        phash: scamImageHashesInAppPublic.phash,
        label: scamImageHashesInAppPublic.label,
        s3Key: scamImageHashesInAppPublic.s3Key,
        addedAt: scamImageHashesInAppPublic.addedAt,
        phashDistance: phashDistanceExpr,
      })
      .from(scamImageHashesInAppPublic)
      .orderBy(asc(phashDistanceExpr))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return {
      entry: this.rowToEntity(rows[0]),
      phashDistance: rows[0].phashDistance,
    };
  }

  async add(phash: bigint, label?: string, s3Key?: string): Promise<number> {
    const signedPhash = toSignedBigint(phash);

    const rows = await this.db
      .insert(scamImageHashesInAppPublic)
      .values({
        phash: signedPhash,
        label: label ?? null,
        s3Key: s3Key ?? null,
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

  async removeByPhashes(phashes: bigint[]): Promise<void> {
    if (phashes.length === 0) {
      return;
    }
    const signed = phashes.map(toSignedBigint);
    await this.db
      .delete(scamImageHashesInAppPublic)
      .where(inArray(scamImageHashesInAppPublic.phash, signed));
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
    phash: bigint | null;
    label: string | null;
    s3Key: string | null;
    addedAt: Date;
  }): ScamImageHash {
    return {
      id: row.id,
      phash: row.phash !== null ? toUnsignedBigint(row.phash) : null,
      label: row.label,
      s3Key: row.s3Key,
      addedAt: row.addedAt,
    };
  }
}
