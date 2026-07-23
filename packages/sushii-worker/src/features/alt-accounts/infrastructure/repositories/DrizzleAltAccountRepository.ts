import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import {
  altIdentitiesInAppPublic,
  altIdentityMembersInAppPublic,
} from "@/infrastructure/database/schema";

import { AltIdentity } from "../../domain/entities/AltIdentity";
import { AltIdentityMember } from "../../domain/entities/AltIdentityMember";
import type {
  AltAccountRepository,
  LinkOutcome,
  RemoveMemberOutcome,
} from "../../domain/repositories/AltAccountRepository";
import type { AltIdentitySummary, AltIdentityWithMembers } from "../../domain/types/AltIdentityWithMembers";

// Postgres unique_violation
const UNIQUE_VIOLATION = "23505";

type DbType = NodePgDatabase<typeof schema>;

export class DrizzleAltAccountRepository implements AltAccountRepository {
  constructor(
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  async link(
    guildId: string,
    userIdA: string,
    userIdB: string,
    linkedBy: string,
    reason: string | null,
    tx?: DbType,
    retrying = false,
  ): Promise<Result<LinkOutcome, string>> {
    const doLink = async (activeTx: DbType): Promise<LinkOutcome> => {
      const guildIdBigInt = BigInt(guildId);

      const existingMembers = await activeTx
        .select()
        .from(altIdentityMembersInAppPublic)
        .where(
          and(
            eq(altIdentityMembersInAppPublic.guildId, guildIdBigInt),
            inArray(altIdentityMembersInAppPublic.userId, [
              BigInt(userIdA),
              BigInt(userIdB),
            ]),
          ),
        );

      const memberA = existingMembers.find(
        (m) => m.userId === BigInt(userIdA),
      );
      const memberB = existingMembers.find(
        (m) => m.userId === BigInt(userIdB),
      );

      if (memberA && memberB) {
        if (memberA.identityId === memberB.identityId) {
          const identity = await this.loadIdentity(
            activeTx,
            guildId,
            memberA.identityId,
          );
          return { kind: "alreadyLinked", identity: identity! };
        }

        return this.mergeIdentities(
          activeTx,
          guildId,
          memberA.identityId,
          memberB.identityId,
        );
      }

      if (memberA || memberB) {
        const existing = (memberA || memberB)!;
        const newUserId = memberA ? userIdB : userIdA;

        await activeTx.insert(altIdentityMembersInAppPublic).values({
          identityId: existing.identityId,
          guildId: guildIdBigInt,
          userId: BigInt(newUserId),
          linkedBy: BigInt(linkedBy),
          reason,
        });

        const identity = await this.loadIdentity(
          activeTx,
          guildId,
          existing.identityId,
        );
        return { kind: "added", identity: identity!, addedUserId: newUserId };
      }

      const [newIdentityRow] = await activeTx
        .insert(altIdentitiesInAppPublic)
        .values({ guildId: guildIdBigInt })
        .returning();

      await activeTx.insert(altIdentityMembersInAppPublic).values([
        {
          identityId: newIdentityRow.id,
          guildId: guildIdBigInt,
          userId: BigInt(userIdA),
          linkedBy: BigInt(linkedBy),
          reason,
        },
        {
          identityId: newIdentityRow.id,
          guildId: guildIdBigInt,
          userId: BigInt(userIdB),
          linkedBy: BigInt(linkedBy),
          reason,
        },
      ]);

      const identity = await this.loadIdentity(
        activeTx,
        guildId,
        newIdentityRow.id,
      );
      return { kind: "created", identity: identity! };
    };

    try {
      const outcome = tx
        ? await doLink(tx)
        : await this.db.transaction((innerTx) => doLink(innerTx));

      return Ok(outcome);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        this.logger.debug(
          { guildId, userIdA, userIdB },
          "Link race lost to a concurrent insert, re-reading committed state",
        );

        const [reReadA, reReadB] = await Promise.all([
          this.findIdentityByUserId(guildId, userIdA),
          this.findIdentityByUserId(guildId, userIdB),
        ]);

        if (
          reReadA.ok &&
          reReadB.ok &&
          reReadA.val &&
          reReadB.val &&
          reReadA.val.identity.id === reReadB.val.identity.id
        ) {
          return Ok({ kind: "alreadyLinked", identity: reReadA.val });
        }

        if (!retrying) {
          this.logger.debug(
            { guildId, userIdA, userIdB },
            "Link race did not resolve to a shared identity yet, retrying once",
          );

          return this.link(
            guildId,
            userIdA,
            userIdB,
            linkedBy,
            reason,
            tx,
            true,
          );
        }
      }

      this.logger.error(
        { err, guildId, userIdA, userIdB },
        "Failed to link accounts",
      );
      return Err(`Failed to link accounts: ${err}`);
    }
  }

  private async mergeIdentities(
    activeTx: DbType,
    guildId: string,
    identityIdA: number,
    identityIdB: number,
  ): Promise<LinkOutcome> {
    const guildIdBigInt = BigInt(guildId);

    // Deterministic keep/discard so concurrent merges of the same pair agree.
    const keepId = Math.min(identityIdA, identityIdB);
    const discardId = Math.max(identityIdA, identityIdB);

    const [keepRow] = await activeTx
      .select()
      .from(altIdentitiesInAppPublic)
      .where(
        and(
          eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
          eq(altIdentitiesInAppPublic.id, keepId),
        ),
      );
    const [discardRow] = await activeTx
      .select()
      .from(altIdentitiesInAppPublic)
      .where(
        and(
          eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
          eq(altIdentitiesInAppPublic.id, discardId),
        ),
      );

    if (!keepRow || !discardRow) {
      throw new Error(
        "Alt identity was concurrently modified during merge, please retry",
      );
    }

    await activeTx
      .update(altIdentityMembersInAppPublic)
      .set({ identityId: keepId })
      .where(
        and(
          eq(altIdentityMembersInAppPublic.guildId, guildIdBigInt),
          eq(altIdentityMembersInAppPublic.identityId, discardId),
        ),
      );

    const keptNickname = keepRow.nickname;
    const discardedNickname = discardRow.nickname;

    if (!keptNickname && discardedNickname) {
      await activeTx
        .update(altIdentitiesInAppPublic)
        .set({ nickname: discardedNickname })
        .where(
          and(
            eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
            eq(altIdentitiesInAppPublic.id, keepId),
          ),
        );
    }

    await activeTx
      .delete(altIdentitiesInAppPublic)
      .where(
        and(
          eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
          eq(altIdentitiesInAppPublic.id, discardId),
        ),
      );

    const identity = await this.loadIdentity(activeTx, guildId, keepId);

    return {
      kind: "merged",
      identity: identity!,
      keptNickname,
      discardedNickname,
    };
  }

  async findIdentityByUserId(
    guildId: string,
    userId: string,
    tx?: DbType,
  ): Promise<Result<AltIdentityWithMembers | null, string>> {
    const db = tx || this.db;
    try {
      const [memberRow] = await db
        .select()
        .from(altIdentityMembersInAppPublic)
        .where(
          and(
            eq(altIdentityMembersInAppPublic.guildId, BigInt(guildId)),
            eq(altIdentityMembersInAppPublic.userId, BigInt(userId)),
          ),
        );

      if (!memberRow) {
        return Ok(null);
      }

      const identity = await this.loadIdentity(
        db,
        guildId,
        memberRow.identityId,
      );

      return Ok(identity);
    } catch (err) {
      this.logger.error(
        { err, guildId, userId },
        "Failed to find alt identity by user ID",
      );
      return Err(`Failed to find alt identity: ${err}`);
    }
  }

  async findIdentityById(
    guildId: string,
    identityId: number,
    tx?: DbType,
  ): Promise<Result<AltIdentityWithMembers | null, string>> {
    const db = tx || this.db;
    try {
      return Ok(await this.loadIdentity(db, guildId, identityId));
    } catch (err) {
      this.logger.error(
        { err, guildId, identityId },
        "Failed to find alt identity by ID",
      );
      return Err(`Failed to find alt identity: ${err}`);
    }
  }

  async removeMember(
    guildId: string,
    userId: string,
    tx?: DbType,
  ): Promise<Result<RemoveMemberOutcome, string>> {
    const doRemove = async (activeTx: DbType): Promise<RemoveMemberOutcome> => {
      const guildIdBigInt = BigInt(guildId);

      const [deletedRow] = await activeTx
        .delete(altIdentityMembersInAppPublic)
        .where(
          and(
            eq(altIdentityMembersInAppPublic.guildId, guildIdBigInt),
            eq(altIdentityMembersInAppPublic.userId, BigInt(userId)),
          ),
        )
        .returning();

      if (!deletedRow) {
        return { kind: "notLinked" };
      }

      const remaining = await activeTx
        .select({ userId: altIdentityMembersInAppPublic.userId })
        .from(altIdentityMembersInAppPublic)
        .where(
          and(
            eq(altIdentityMembersInAppPublic.guildId, guildIdBigInt),
            eq(altIdentityMembersInAppPublic.identityId, deletedRow.identityId),
          ),
        )
        .limit(1);

      if (remaining.length > 0) {
        return { kind: "removed", identityDeleted: false };
      }

      await activeTx
        .delete(altIdentitiesInAppPublic)
        .where(
          and(
            eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
            eq(altIdentitiesInAppPublic.id, deletedRow.identityId),
          ),
        );

      return { kind: "removed", identityDeleted: true };
    };

    try {
      const outcome = tx
        ? await doRemove(tx)
        : await this.db.transaction((innerTx) => doRemove(innerTx));

      return Ok(outcome);
    } catch (err) {
      this.logger.error({ err, guildId, userId }, "Failed to remove alt member");
      return Err(`Failed to remove alt member: ${err}`);
    }
  }

  async setNickname(
    guildId: string,
    identityId: number,
    nickname: string | null,
    tx?: DbType,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      await db
        .update(altIdentitiesInAppPublic)
        .set({ nickname })
        .where(
          and(
            eq(altIdentitiesInAppPublic.guildId, BigInt(guildId)),
            eq(altIdentitiesInAppPublic.id, identityId),
          ),
        );

      return Ok.EMPTY;
    } catch (err) {
      this.logger.error(
        { err, guildId, identityId },
        "Failed to set alt identity nickname",
      );
      return Err(`Failed to set nickname: ${err}`);
    }
  }

  async listIdentities(
    guildId: string,
    limit: number,
    offset: number,
    tx?: DbType,
  ): Promise<Result<AltIdentitySummary[], string>> {
    const db = tx || this.db;
    try {
      const memberCount = sql<number>`count(${altIdentityMembersInAppPublic.userId})`.mapWith(
        Number,
      );
      const memberIds = sql<string[]>`array_agg(${altIdentityMembersInAppPublic.userId}::text order by ${altIdentityMembersInAppPublic.linkedAt}) filter (where ${altIdentityMembersInAppPublic.userId} is not null)`;

      const rows = await db
        .select({
          id: altIdentitiesInAppPublic.id,
          guildId: altIdentitiesInAppPublic.guildId,
          nickname: altIdentitiesInAppPublic.nickname,
          memberCount,
          memberIds,
        })
        .from(altIdentitiesInAppPublic)
        .leftJoin(
          altIdentityMembersInAppPublic,
          and(
            eq(
              altIdentityMembersInAppPublic.guildId,
              altIdentitiesInAppPublic.guildId,
            ),
            eq(
              altIdentityMembersInAppPublic.identityId,
              altIdentitiesInAppPublic.id,
            ),
          ),
        )
        .where(eq(altIdentitiesInAppPublic.guildId, BigInt(guildId)))
        .groupBy(
          altIdentitiesInAppPublic.guildId,
          altIdentitiesInAppPublic.id,
          altIdentitiesInAppPublic.nickname,
        )
        .orderBy(desc(memberCount), asc(altIdentitiesInAppPublic.id))
        .limit(limit)
        .offset(offset);

      const summaries: AltIdentitySummary[] = rows.map((row) => ({
        id: row.id,
        guildId: row.guildId.toString(),
        nickname: row.nickname,
        memberCount: row.memberCount,
        memberIds: row.memberIds ?? [],
      }));

      return Ok(summaries);
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to list alt identities");
      return Err(`Failed to list identities: ${err}`);
    }
  }

  async countIdentities(
    guildId: string,
    tx?: DbType,
  ): Promise<Result<number, string>> {
    const db = tx || this.db;
    try {
      const [row] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(altIdentitiesInAppPublic)
        .where(eq(altIdentitiesInAppPublic.guildId, BigInt(guildId)));

      return Ok(row?.count ?? 0);
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to count alt identities");
      return Err(`Failed to count identities: ${err}`);
    }
  }

  private async loadIdentity(
    db: DbType,
    guildId: string,
    identityId: number,
  ): Promise<AltIdentityWithMembers | null> {
    const [identityRow] = await db
      .select()
      .from(altIdentitiesInAppPublic)
      .where(
        and(
          eq(altIdentitiesInAppPublic.guildId, BigInt(guildId)),
          eq(altIdentitiesInAppPublic.id, identityId),
        ),
      );

    if (!identityRow) {
      return null;
    }

    const memberRows = await db
      .select()
      .from(altIdentityMembersInAppPublic)
      .where(
        and(
          eq(altIdentityMembersInAppPublic.guildId, BigInt(guildId)),
          eq(altIdentityMembersInAppPublic.identityId, identityId),
        ),
      )
      .orderBy(asc(altIdentityMembersInAppPublic.linkedAt));

    return {
      identity: AltIdentity.fromData({
        id: identityRow.id,
        guildId: identityRow.guildId.toString(),
        nickname: identityRow.nickname,
        createdAt: identityRow.createdAt,
      }),
      members: memberRows.map((row) =>
        AltIdentityMember.fromData({
          identityId: row.identityId,
          guildId: row.guildId.toString(),
          userId: row.userId.toString(),
          linkedBy: row.linkedBy.toString(),
          linkedAt: row.linkedAt,
          reason: row.reason,
        }),
      ),
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION
    );
  }
}
