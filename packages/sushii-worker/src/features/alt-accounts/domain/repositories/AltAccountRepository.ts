import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";

import type { AltIdentitySummary, AltIdentityWithMembers } from "../types/AltIdentityWithMembers";

/**
 * Outcome of a `/alts link` call — the four cases, each carrying the
 * identity state to render back to the mod.
 */
export type LinkOutcome =
  | { kind: "created"; identity: AltIdentityWithMembers }
  | { kind: "added"; identity: AltIdentityWithMembers; addedUserId: string }
  | { kind: "alreadyLinked"; identity: AltIdentityWithMembers }
  | {
      kind: "merged";
      identity: AltIdentityWithMembers;
      /** Nickname on the identity that was kept, before the merge, if any. */
      keptNickname: string | null;
      /** Nickname on the identity that was discarded, if any. */
      discardedNickname: string | null;
    };

export type RemoveMemberOutcome =
  | { kind: "notLinked" }
  | { kind: "removed"; identityDeleted: boolean };

/**
 * Repository for alt-identity linking. `link()` is the primary entry point
 * for creating/growing/merging identities — it performs the whole
 * read-decide-write sequence in one DB transaction.
 */
export interface AltAccountRepository {
  link(
    guildId: string,
    userIdA: string,
    userIdB: string,
    linkedBy: string,
    reason: string | null,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<LinkOutcome, string>>;

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
