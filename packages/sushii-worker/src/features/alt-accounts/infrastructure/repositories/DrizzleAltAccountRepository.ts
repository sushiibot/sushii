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
  MultiLinkOutcome,
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

  async linkMany(
    guildId: string,
    userIds: string[],
    linkedBy: string,
    reason: string | null,
    tx?: DbType,
    retrying = false,
  ): Promise<Result<MultiLinkOutcome, string>> {
    const distinctUserIds = [...new Set(userIds)];
    if (distinctUserIds.length < 2) {
      return Err("Linking requires at least two accounts.");
    }
    userIds = distinctUserIds;

    const doLink = async (activeTx: DbType): Promise<MultiLinkOutcome> => {
      const guildIdBigInt = BigInt(guildId);

      const existingMembers = await activeTx
        .select()
        .from(altIdentityMembersInAppPublic)
        .where(
          and(
            eq(altIdentityMembersInAppPublic.guildId, guildIdBigInt),
            inArray(
              altIdentityMembersInAppPublic.userId,
              userIds.map((id) => BigInt(id)),
            ),
          ),
        );

      const identityByUserId = new Map(
        existingMembers.map((m) => [m.userId.toString(), m.identityId]),
      );
      const identityIds = [...new Set(identityByUserId.values())].sort(
        (a, b) => a - b,
      );

      const unlinkedUserIds = userIds.filter((id) => !identityByUserId.has(id));

      let keepId: number;
      let identityCreated = false;
      let merge = {
        mergedIdentityIds: [] as number[],
        keptNickname: null as string | null,
        adoptedNickname: null as string | null,
        discardedNicknames: [] as string[],
      };

      if (identityIds.length === 0) {
        const [newIdentityRow] = await activeTx
          .insert(altIdentitiesInAppPublic)
          .values({ guildId: guildIdBigInt })
          .returning();

        keepId = newIdentityRow.id;
        identityCreated = true;
      } else {
        keepId = identityIds[0];

        if (identityIds.length > 1) {
          merge = await this.mergeIdentitiesInto(
            activeTx,
            guildId,
            keepId,
            identityIds.slice(1),
          );
        } else {
          const [keepRow] = await activeTx
            .select()
            .from(altIdentitiesInAppPublic)
            .where(
              and(
                eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
                eq(altIdentitiesInAppPublic.id, keepId),
              ),
            )
            .for("update");

          if (!keepRow) {
            throw new Error(
              "Alt identity was concurrently modified during link, please retry",
            );
          }

          merge.keptNickname = keepRow.nickname;
        }
      }

      if (unlinkedUserIds.length > 0) {
        await activeTx.insert(altIdentityMembersInAppPublic).values(
          unlinkedUserIds.map((userId) => ({
            identityId: keepId,
            guildId: guildIdBigInt,
            userId: BigInt(userId),
            linkedBy: BigInt(linkedBy),
            reason,
          })),
        );
      }

      const identity = await this.loadIdentity(activeTx, guildId, keepId);
      if (!identity) {
        throw new Error(
          "Alt identity was concurrently modified during link, please retry",
        );
      }

      return {
        identity,
        identityCreated,
        addedUserIds: unlinkedUserIds,
        alreadyLinkedUserIds: userIds.filter((id) => identityByUserId.has(id)),
        ...merge,
      };
    };

    try {
      const outcome = tx
        ? await doLink(tx)
        : await this.db.transaction((innerTx) => doLink(innerTx));

      return Ok(outcome);
    } catch (err) {
      // A caller-owned transaction is already aborted by the failed statement,
      // so recovery has to happen at the transaction owner, not here.
      if (tx) {
        throw err;
      }

      if (this.isUniqueViolation(err)) {
        this.logger.debug(
          { guildId, userIds },
          "Link race lost to a concurrent insert, re-reading committed state",
        );

        const reReads = await Promise.all(
          userIds.map((userId) => this.findIdentityByUserId(guildId, userId)),
        );

        const identities = reReads.map((r) => (r.ok ? r.val : null));
        const first = identities[0];

        if (
          first &&
          identities.every((i) => i && i.identity.id === first.identity.id)
        ) {
          return Ok({
            identity: first,
            identityCreated: false,
            addedUserIds: [],
            alreadyLinkedUserIds: userIds,
            mergedIdentityIds: [],
            keptNickname: first.identity.nickname,
            adoptedNickname: null,
            discardedNicknames: [],
          });
        }

        if (!retrying) {
          this.logger.debug(
            { guildId, userIds },
            "Link race did not resolve to a shared identity yet, retrying once",
          );

          return this.linkMany(
            guildId,
            userIds,
            linkedBy,
            reason,
            undefined,
            true,
          );
        }
      }

      this.logger.error({ err, guildId, userIds }, "Failed to link accounts");
      return Err("Failed to link accounts, please try again.");
    }
  }

  /**
   * Re-points every member of `discardIds` onto `keepId` and deletes the
   * discarded identities. Callers pick `keepId` as the lowest involved id so
   * concurrent merges of the same set agree on a survivor.
   */
  private async mergeIdentitiesInto(
    activeTx: DbType,
    guildId: string,
    keepId: number,
    discardIds: number[],
  ): Promise<{
    mergedIdentityIds: number[];
    keptNickname: string | null;
    adoptedNickname: string | null;
    discardedNicknames: string[];
  }> {
    const guildIdBigInt = BigInt(guildId);

    // Locked in ascending id order (keepId is the lowest) so concurrent merges
    // of overlapping sets queue instead of deadlocking.
    const [keepRow] = await activeTx
      .select()
      .from(altIdentitiesInAppPublic)
      .where(
        and(
          eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
          eq(altIdentitiesInAppPublic.id, keepId),
        ),
      )
      .for("update");

    const discardRows = await activeTx
      .select()
      .from(altIdentitiesInAppPublic)
      .where(
        and(
          eq(altIdentitiesInAppPublic.guildId, guildIdBigInt),
          inArray(altIdentitiesInAppPublic.id, discardIds),
        ),
      )
      .orderBy(asc(altIdentitiesInAppPublic.id))
      .for("update");

    if (!keepRow || discardRows.length !== discardIds.length) {
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
          inArray(altIdentityMembersInAppPublic.identityId, discardIds),
        ),
      );

    const discardedNicknames = discardRows
      .map((row) => row.nickname)
      .filter((nickname): nickname is string => Boolean(nickname));

    const keptNickname = keepRow.nickname;
    let adoptedNickname: string | null = null;

    if (!keptNickname && discardedNicknames.length > 0) {
      adoptedNickname = discardedNicknames.shift()!;

      await activeTx
        .update(altIdentitiesInAppPublic)
        .set({ nickname: adoptedNickname })
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
          inArray(altIdentitiesInAppPublic.id, discardIds),
        ),
      );

    return {
      mergedIdentityIds: discardIds,
      keptNickname,
      adoptedNickname,
      discardedNicknames,
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
      // Batch inserts share one defaultNow(), so linkedAt alone ties arbitrarily.
      .orderBy(
        asc(altIdentityMembersInAppPublic.linkedAt),
        asc(altIdentityMembersInAppPublic.userId),
      );

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
