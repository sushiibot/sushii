import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";

import type { AltIdentitySummary, AltIdentityWithMembers } from "../types/AltIdentityWithMembers";

/**
 * Outcome of a `/alts link` call. Flat rather than a union: one call can
 * create nothing, add some accounts, merge several identities, and no-op on
 * the rest all at once, so there is no single "kind".
 */
export interface MultiLinkOutcome {
  /** The surviving identity with every member, after all writes. */
  identity: AltIdentityWithMembers;
  /** True when no input account had an identity and a fresh one was created. */
  identityCreated: boolean;
  /** Input accounts newly inserted as members, in input order. */
  addedUserIds: string[];
  /** Input accounts that already had an identity, so no row was inserted. */
  alreadyLinkedUserIds: string[];
  /** Identities absorbed into the survivor, ascending. Empty when no merge. */
  mergedIdentityIds: number[];
  /** Nickname the surviving identity already had, if any. */
  keptNickname: string | null;
  /**
   * Nickname taken from a merged-in identity because the survivor had none.
   * Mutually exclusive with `keptNickname`.
   */
  adoptedNickname: string | null;
  /** Non-null nicknames dropped by the merge, in discarded-identity id order. */
  discardedNicknames: string[];
}

export type RemoveMemberOutcome =
  | { kind: "notLinked" }
  | { kind: "removed"; identityDeleted: boolean };

/**
 * Repository for alt-identity linking. `linkMany()` is the primary entry point
 * for creating/growing/merging identities — it performs the whole
 * read-decide-write sequence in one DB transaction.
 */
export interface AltAccountRepository {
  /**
   * Links accounts into a single identity, creating, growing, and merging as
   * needed. `userIds` must be deduplicated and hold at least two entries.
   *
   * When `tx` is supplied the caller owns the transaction, so the internal
   * unique-violation retry is skipped and the error propagates instead — a
   * failed statement has already aborted the caller's transaction.
   */
  linkMany(
    guildId: string,
    userIds: string[],
    linkedBy: string,
    reason: string | null,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<MultiLinkOutcome, string>>;

  findIdentityByUserId(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<AltIdentityWithMembers | null, string>>;

  findIdentityById(
    guildId: string,
    identityId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<AltIdentityWithMembers | null, string>>;

  /**
   * Removes one account's membership. Also deletes the parent identity if
   * it becomes empty.
   */
  removeMember(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<RemoveMemberOutcome, string>>;

  setNickname(
    guildId: string,
    identityId: number,
    nickname: string | null,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /** Sorted member count desc, id asc. */
  listIdentities(
    guildId: string,
    limit: number,
    offset: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<AltIdentitySummary[], string>>;

  countIdentities(
    guildId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>>;
}
