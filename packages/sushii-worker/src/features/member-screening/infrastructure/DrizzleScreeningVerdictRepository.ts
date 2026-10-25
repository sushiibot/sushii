import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { screeningVerdictsInAppPublic as verdicts } from "@/infrastructure/database/schema";

import type { ScreeningVerdictRepository } from "../domain/repositories/ScreeningVerdictRepository";
import type {
  AutomodSummary,
  IgnoreReason,
  NewScreeningVerdict,
  ScreeningGuildStats,
  ScreeningVerdict,
  VerdictKind,
} from "../domain/types";

type VerdictRow = typeof verdicts.$inferSelect;

const CHECK_KINDS = ["text", "pfp", "image"] as const;

function toBigInt(value: string | null | undefined): bigint | null {
  return value ? BigInt(value) : null;
}

function toVerdict(row: VerdictRow): ScreeningVerdict {
  return {
    id: row.id,
    guildId: row.guildId.toString(),
    channelId: row.channelId.toString(),
    userId: row.userId.toString(),
    messageId: row.messageId.toString(),
    kind: row.kind,
    scores: row.scores ?? null,
    categories: row.categories ?? null,
    topRule: row.topRule ?? null,
    flagged: row.flagged,
    avatarHash: row.avatarHash,
    imageKey: row.imageKey,
    sourceUrl: row.sourceUrl,
    joinedAt: row.joinedAt,
    ordinal: row.ordinal,
    model: row.model,
    cost: row.cost,
    judged: row.judged ?? null,
    error: row.error,
    postChannelId: row.postChannelId?.toString() ?? null,
    postMessageId: row.postMessageId?.toString() ?? null,
    outcome: row.outcome,
    outcomeBy: row.outcomeBy?.toString() ?? null,
    outcomeAction: row.outcomeAction,
    ignoreReason: row.ignoreReason,
    outcomeAt: row.outcomeAt,
    messageDeleted: row.messageDeleted,
    createdAt: row.createdAt,
  };
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export class DrizzleScreeningVerdictRepository
  implements ScreeningVerdictRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async insert(verdict: NewScreeningVerdict): Promise<ScreeningVerdict> {
    const flagged = verdict.flagged ?? false;

    const [row] = await this.db
      .insert(verdicts)
      .values({
        guildId: BigInt(verdict.guildId),
        channelId: BigInt(verdict.channelId),
        userId: BigInt(verdict.userId),
        messageId: BigInt(verdict.messageId),
        kind: verdict.kind,
        scores: verdict.scores ?? null,
        categories: verdict.categories ?? null,
        topRule: verdict.topRule ?? null,
        flagged,
        avatarHash: verdict.avatarHash ?? null,
        imageKey: verdict.imageKey ?? null,
        sourceUrl: verdict.sourceUrl ?? null,
        joinedAt: verdict.joinedAt ?? null,
        ordinal: verdict.ordinal ?? null,
        model: verdict.model ?? null,
        cost: verdict.cost ?? null,
        // Unflagged checks only need dedupe/outcome metadata, not a transcript.
        judged: flagged ? (verdict.judged ?? null) : null,
        error: verdict.error ?? null,
        outcome: verdict.outcome ?? null,
        outcomeBy: toBigInt(verdict.outcomeBy),
        outcomeAction: verdict.outcomeAction ?? null,
        outcomeAt: verdict.outcomeAt ?? null,
        createdAt: verdict.createdAt,
      })
      .returning();

    return toVerdict(row);
  }

  async findById(id: number): Promise<ScreeningVerdict | null> {
    const [row] = await this.db
      .select()
      .from(verdicts)
      .where(eq(verdicts.id, id))
      .limit(1);

    return row ? toVerdict(row) : null;
  }

  async hasPfpVerdict(userId: string, avatarHash: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: verdicts.id })
      .from(verdicts)
      .where(
        and(
          eq(verdicts.kind, "pfp"),
          eq(verdicts.userId, BigInt(userId)),
          eq(verdicts.avatarHash, avatarHash),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async hasImageVerdict(guildId: string, imageKey: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: verdicts.id })
      .from(verdicts)
      .where(
        and(
          eq(verdicts.kind, "image"),
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.imageKey, imageKey),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async countChecksToday(guildId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(verdicts)
      .where(
        and(
          eq(verdicts.guildId, BigInt(guildId)),
          inArray(verdicts.kind, [...CHECK_KINDS]),
          gte(verdicts.createdAt, startOfUtcDay(this.now())),
        ),
      );

    return row?.count ?? 0;
  }

  async findOpenTextPost(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<ScreeningVerdict | null> {
    const [row] = await this.db
      .select()
      .from(verdicts)
      .where(
        and(
          eq(verdicts.kind, "text"),
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.userId, BigInt(userId)),
          eq(verdicts.flagged, true),
          gte(verdicts.createdAt, since),
          isNull(verdicts.outcome),
          isNotNull(verdicts.postMessageId),
        ),
      )
      .orderBy(desc(verdicts.createdAt), desc(verdicts.id))
      .limit(1);

    return row ? toVerdict(row) : null;
  }

  async setPost(
    id: number,
    postChannelId: string,
    postMessageId: string,
  ): Promise<void> {
    await this.db
      .update(verdicts)
      .set({
        postChannelId: BigInt(postChannelId),
        postMessageId: BigInt(postMessageId),
      })
      .where(eq(verdicts.id, id));
  }

  async latestForPost(postMessageId: string): Promise<ScreeningVerdict | null> {
    const [row] = await this.db
      .select()
      .from(verdicts)
      .where(eq(verdicts.postMessageId, BigInt(postMessageId)))
      .orderBy(desc(verdicts.id))
      .limit(1);

    return row ? toVerdict(row) : null;
  }

  async postedForUser(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<ScreeningVerdict[]> {
    const rows = await this.db
      .select()
      .from(verdicts)
      .where(
        and(
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.userId, BigInt(userId)),
          eq(verdicts.flagged, true),
          gte(verdicts.createdAt, since),
          isNotNull(verdicts.postMessageId),
        ),
      )
      .orderBy(verdicts.id);

    return rows.map(toVerdict);
  }

  async hasFlagSince(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: verdicts.id })
      .from(verdicts)
      .where(
        and(
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.userId, BigInt(userId)),
          eq(verdicts.flagged, true),
          gte(verdicts.createdAt, since),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async hasCheckSince(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<boolean> {
    return this.existsSince(guildId, userId, since, [...CHECK_KINDS], true);
  }

  async hasMissSince(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<boolean> {
    return this.existsSince(guildId, userId, since, ["miss"]);
  }

  private async existsSince(
    guildId: string,
    userId: string,
    since: Date,
    kinds: VerdictKind[],
    succeededOnly = false,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: verdicts.id })
      .from(verdicts)
      .where(
        and(
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.userId, BigInt(userId)),
          gte(verdicts.createdAt, since),
          inArray(verdicts.kind, kinds),
          succeededOnly ? isNull(verdicts.error) : undefined,
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async automodSummary(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<AutomodSummary> {
    const rows = await this.db
      .select({ categories: verdicts.categories })
      .from(verdicts)
      .where(
        and(
          eq(verdicts.kind, "automod"),
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.userId, BigInt(userId)),
          gte(verdicts.createdAt, since),
        ),
      );

    const rules = new Set<string>();
    for (const row of rows) {
      for (const rule of row.categories ?? []) {
        rules.add(rule);
      }
    }

    return { count: rows.length, rules: [...rules] };
  }

  async setIgnored(
    postMessageId: string,
    by: string,
    reason: IgnoreReason,
    at: Date,
  ): Promise<ScreeningVerdict[]> {
    const rows = await this.db
      .update(verdicts)
      .set({
        outcome: "ignored",
        outcomeBy: BigInt(by),
        outcomeAction: null,
        ignoreReason: reason,
        outcomeAt: at,
      })
      .where(
        and(
          eq(verdicts.postMessageId, BigInt(postMessageId)),
          isNull(verdicts.outcome),
        ),
      )
      .returning();

    return rows.map(toVerdict);
  }

  async setActioned(
    guildId: string,
    userId: string,
    since: Date,
    by: string | null,
    action: string,
    at: Date,
  ): Promise<ScreeningVerdict[]> {
    const rows = await this.db
      .update(verdicts)
      .set({
        outcome: "actioned",
        outcomeBy: toBigInt(by),
        outcomeAction: action,
        outcomeAt: at,
      })
      .where(
        and(
          eq(verdicts.guildId, BigInt(guildId)),
          eq(verdicts.userId, BigInt(userId)),
          eq(verdicts.flagged, true),
          gte(verdicts.createdAt, since),
          or(isNull(verdicts.outcome), eq(verdicts.outcome, "ignored")),
        ),
      )
      .returning();

    return rows.map(toVerdict);
  }

  async updateOutcomeAction(
    postMessageId: string,
    action: string,
    by: string,
    at: Date,
  ): Promise<ScreeningVerdict[]> {
    const rows = await this.db
      .update(verdicts)
      .set({ outcomeAction: action, outcomeBy: BigInt(by), outcomeAt: at })
      .where(
        and(
          eq(verdicts.postMessageId, BigInt(postMessageId)),
          eq(verdicts.outcome, "actioned"),
        ),
      )
      .returning();

    return rows.map(toVerdict);
  }

  async markMessageDeleted(messageIds: string[]): Promise<ScreeningVerdict[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .update(verdicts)
      .set({ messageDeleted: true })
      .where(
        and(
          inArray(
            verdicts.messageId,
            messageIds.map((id) => BigInt(id)),
          ),
          eq(verdicts.flagged, true),
        ),
      )
      .returning();

    return rows.filter((row) => row.postMessageId !== null).map(toVerdict);
  }

  async statsSince(since: Date): Promise<ScreeningGuildStats[]> {
    // A burst of verdicts edits one post, so post-level counts reconcile with what mods see.
    const postKey = sql`coalesce(${verdicts.postMessageId}::text, 'v' || ${verdicts.id}::text)`;
    const rows = await this.db
      .select({
        guildId: verdicts.guildId,
        checks: sql<number>`(count(*) filter (where ${inArray(verdicts.kind, [...CHECK_KINDS])}))::int`,
        flagged: sql<number>`(count(distinct ${postKey}) filter (where ${verdicts.flagged}))::int`,
        actioned: sql<number>`(count(distinct ${postKey}) filter (where ${verdicts.outcome} = 'actioned'))::int`,
        ignored: sql<number>`(count(distinct ${postKey}) filter (where ${verdicts.outcome} = 'ignored'))::int`,
        awaiting: sql<number>`(count(distinct ${postKey}) filter (where ${verdicts.flagged} and ${verdicts.postMessageId} is not null and ${verdicts.outcome} is null))::int`,
        missed: sql<number>`(count(*) filter (where ${verdicts.kind} = 'miss'))::int`,
        cost: sql<number>`coalesce(sum(${verdicts.cost}), 0)::float8`,
      })
      .from(verdicts)
      .where(gte(verdicts.createdAt, since))
      .groupBy(verdicts.guildId)
      .orderBy(verdicts.guildId);

    return rows.map((row) => ({
      guildId: row.guildId.toString(),
      checks: Number(row.checks),
      flagged: Number(row.flagged),
      actioned: Number(row.actioned),
      ignored: Number(row.ignored),
      awaiting: Number(row.awaiting),
      missed: Number(row.missed),
      cost: Number(row.cost),
    }));
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.db
      .delete(verdicts)
      .where(lt(verdicts.createdAt, date));

    return result.rowCount ?? 0;
  }
}
