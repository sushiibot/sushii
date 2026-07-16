import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { scamHashReportsInAppPublic } from "@/infrastructure/database/schema";
import type {
  CreateScamHashReportInput,
  ScamHashReport,
  ScamHashReportRepository,
} from "../domain/repositories/ScamHashReportRepository";

import type * as schema from "@/infrastructure/database/schema";

export class DrizzleScamHashReportRepository implements ScamHashReportRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(input: CreateScamHashReportInput): Promise<number> {
    const rows = await this.db
      .insert(scamHashReportsInAppPublic)
      .values({
        hashId: input.hashId,
        reporterId: input.reporterId,
        guildId: input.guildId,
        guildName: input.guildName,
      })
      .returning({ id: scamHashReportsInAppPublic.id });

    return rows[0].id;
  }

  async findById(id: number): Promise<ScamHashReport | null> {
    const rows = await this.db
      .select()
      .from(scamHashReportsInAppPublic)
      .where(eq(scamHashReportsInAppPublic.id, id))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  async findActive(hashId: number, reporterId: string): Promise<ScamHashReport | null> {
    const rows = await this.db
      .select()
      .from(scamHashReportsInAppPublic)
      .where(
        and(
          eq(scamHashReportsInAppPublic.hashId, hashId),
          eq(scamHashReportsInAppPublic.reporterId, reporterId),
          inArray(scamHashReportsInAppPublic.status, ["pending", "posted"]),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  async getPendingRows(): Promise<ScamHashReport[]> {
    return this.db
      .select()
      .from(scamHashReportsInAppPublic)
      .where(eq(scamHashReportsInAppPublic.status, "pending"));
  }

  async markPosted(id: number, reviewMessageId: string): Promise<void> {
    await this.db
      .update(scamHashReportsInAppPublic)
      .set({ status: "posted", reviewMessageId, updatedAt: sql`now()` })
      .where(eq(scamHashReportsInAppPublic.id, id));
  }

  async resolve(id: number, status: "reverted" | "dismissed"): Promise<boolean> {
    const rows = await this.db
      .update(scamHashReportsInAppPublic)
      .set({ status, updatedAt: sql`now()` })
      .where(
        and(
          eq(scamHashReportsInAppPublic.id, id),
          // A row is resolvable whether or not markPosted() has landed yet —
          // the review message (and its buttons) exists as soon as send()
          // returns, before the DB write confirming it is done.
          inArray(scamHashReportsInAppPublic.status, ["pending", "posted"]),
        ),
      )
      .returning({ id: scamHashReportsInAppPublic.id });

    return rows.length > 0;
  }

  /** Compensates a resolve() claim when the follow-up action (e.g. hash deletion) fails, so the report stays retryable instead of stuck in a terminal state with no corresponding effect. */
  async revertToPosted(id: number): Promise<void> {
    await this.db
      .update(scamHashReportsInAppPublic)
      .set({ status: "posted", updatedAt: sql`now()` })
      .where(eq(scamHashReportsInAppPublic.id, id));
  }
}
