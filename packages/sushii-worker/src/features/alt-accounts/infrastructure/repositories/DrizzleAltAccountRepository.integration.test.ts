import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pino } from "pino";
import type { Logger } from "pino";

import {
  altIdentitiesInAppPublic,
  altIdentityMembersInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleAltAccountRepository } from "./DrizzleAltAccountRepository";

const GUILD_A = "111111111111111111";
const GUILD_B = "999999999999999999";
const USER_1 = "222222222222222222";
const USER_2 = "333333333333333333";
const USER_3 = "444444444444444444";
const USER_4 = "666666666666666666";
const USER_5 = "777777777777777777";
const USER_6 = "888888888888888888";
const MOD_ID = "555555555555555555";

describe("DrizzleAltAccountRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleAltAccountRepository;
  let logger: Logger;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    logger = pino({ level: "silent" });
    repo = new DrizzleAltAccountRepository(db, logger);
  });

  beforeEach(async () => {
    await db.delete(altIdentityMembersInAppPublic);
    await db.delete(altIdentitiesInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("linkMany", () => {
    test("creates a new identity when neither account is linked", async () => {
      const result = await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, "same person");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.identityCreated).toBe(true);
        expect(result.val.addedUserIds).toEqual([USER_1, USER_2]);
        expect(result.val.mergedIdentityIds).toEqual([]);
        expect(result.val.identity.members).toHaveLength(2);
      }
    });

    test("adds to an existing identity when one account is already linked", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      const result = await repo.linkMany(GUILD_A, [USER_1, USER_3], MOD_ID, null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.identityCreated).toBe(false);
        expect(result.val.addedUserIds).toEqual([USER_3]);
        expect(result.val.alreadyLinkedUserIds).toEqual([USER_1]);
        expect(result.val.identity.members).toHaveLength(3);
      }
    });

    test("adds nothing when every account already shares an identity", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      const result = await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.addedUserIds).toEqual([]);
        expect(result.val.mergedIdentityIds).toEqual([]);
        expect(result.val.alreadyLinkedUserIds).toEqual([USER_1, USER_2]);
      }
    });

    test("creates one identity from more than two unlinked accounts", async () => {
      const result = await repo.linkMany(
        GUILD_A,
        [USER_1, USER_2, USER_3, USER_4],
        MOD_ID,
        null,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.identityCreated).toBe(true);
        expect(result.val.addedUserIds).toHaveLength(4);
        expect(result.val.identity.members).toHaveLength(4);
      }
    });

    test("adds only the unlinked accounts when the set is mixed", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);

      const result = await repo.linkMany(
        GUILD_A,
        [USER_1, USER_2, USER_3, USER_4],
        MOD_ID,
        null,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.identityCreated).toBe(false);
        expect(result.val.mergedIdentityIds).toEqual([]);
        expect(result.val.addedUserIds).toEqual([USER_3, USER_4]);
        expect(result.val.alreadyLinkedUserIds).toEqual([USER_1, USER_2]);
        expect(result.val.identity.members).toHaveLength(4);
      }
    });

    test("merges two different identities", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      await repo.linkMany(GUILD_A, [USER_3, USER_4], MOD_ID, null);

      const result = await repo.linkMany(GUILD_A, [USER_1, USER_3], MOD_ID, null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.mergedIdentityIds).toHaveLength(1);
        expect(result.val.identity.members).toHaveLength(4);
      }
    });

    test("collapses three identities into the lowest id", async () => {
      const first = await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      const second = await repo.linkMany(GUILD_A, [USER_3, USER_4], MOD_ID, null);
      const third = await repo.linkMany(GUILD_A, [USER_5, USER_6], MOD_ID, null);
      if (!first.ok || !second.ok || !third.ok) {
        throw new Error("setup failed");
      }

      const keepId = first.val.identity.identity.id;
      const discardIds = [
        second.val.identity.identity.id,
        third.val.identity.identity.id,
      ].sort((a, b) => a - b);

      await repo.setNickname(GUILD_A, discardIds[0], "second group");
      await repo.setNickname(GUILD_A, discardIds[1], "third group");

      const result = await repo.linkMany(
        GUILD_A,
        [USER_1, USER_3, USER_5],
        MOD_ID,
        null,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.identity.identity.id).toBe(keepId);
        expect(result.val.mergedIdentityIds).toEqual(discardIds);
        expect(result.val.identity.members).toHaveLength(6);
        // Keeper had no nickname, so it adopts the lowest-id discarded one.
        expect(result.val.keptNickname).toBeNull();
        expect(result.val.adoptedNickname).toBe("second group");
        expect(result.val.discardedNicknames).toEqual(["third group"]);
      }
    });

    test("merge keeps the only nickname when just one identity has one", async () => {
      const first = await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      const second = await repo.linkMany(GUILD_A, [USER_3, USER_4], MOD_ID, null);
      if (!first.ok || !second.ok) {
        throw new Error("setup failed");
      }

      await repo.setNickname(GUILD_A, second.val.identity.identity.id, "Named Group");

      const merged = await repo.linkMany(GUILD_A, [USER_1, USER_3], MOD_ID, null);

      expect(merged.ok).toBe(true);
      if (merged.ok) {
        expect(merged.val.identity.identity.nickname).toBe("Named Group");
        expect(merged.val.keptNickname).toBeNull();
        expect(merged.val.adoptedNickname).toBe("Named Group");
        expect(merged.val.discardedNicknames).toEqual([]);
      }
    });

    test("rejects fewer than two accounts", async () => {
      const result = await repo.linkMany(GUILD_A, [USER_1], MOD_ID, null);

      expect(result.err).toBe(true);
    });

    test("scopes identities per guild", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);

      const guildBResult = await repo.findIdentityByUserId(GUILD_B, USER_1);
      expect(guildBResult.ok).toBe(true);
      if (guildBResult.ok) {
        expect(guildBResult.val).toBeNull();
      }
    });
  });

  describe("removeMember", () => {
    test("removes one member without deleting the identity when others remain", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);

      const result = await repo.removeMember(GUILD_A, USER_1);

      expect(result.ok).toBe(true);
      if (result.ok && result.val.kind === "removed") {
        expect(result.val.identityDeleted).toBe(false);
      }

      const remaining = await repo.findIdentityByUserId(GUILD_A, USER_2);
      expect(remaining.ok).toBe(true);
      if (remaining.ok) {
        expect(remaining.val?.members).toHaveLength(1);
      }
    });

    test("deletes the identity when removing its last member", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      await repo.removeMember(GUILD_A, USER_1);

      const result = await repo.removeMember(GUILD_A, USER_2);

      expect(result.ok).toBe(true);
      if (result.ok && result.val.kind === "removed") {
        expect(result.val.identityDeleted).toBe(true);
      }
    });

    test("returns 'notLinked' for an account with no identity", async () => {
      const result = await repo.removeMember(GUILD_A, USER_1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.kind).toBe("notLinked");
      }
    });
  });

  describe("listIdentities", () => {
    test("sorts by member count desc, id asc", async () => {
      const pair = await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      const trio = await repo.linkMany(GUILD_A, [USER_3, USER_4], MOD_ID, null);
      if (!trio.ok) {
        throw new Error("setup failed");
      }
      await repo.linkMany(GUILD_A, [USER_4, USER_5], MOD_ID, null);

      const result = await repo.listIdentities(GUILD_A, 10, 0);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.map((i) => i.memberCount)).toEqual([3, 2]);
        expect(result.val.map((i) => i.memberIds.length)).toEqual([3, 2]);
      }
      expect(pair.ok).toBe(true);
    });

    test("includes member IDs for each identity", async () => {
      await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);

      const result = await repo.listIdentities(GUILD_A, 10, 0);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val[0].memberIds.sort()).toEqual(
          [USER_1, USER_2].sort(),
        );
      }
    });
  });

  describe("findIdentityById", () => {
    test("fetches an identity by ID", async () => {
      const linked = await repo.linkMany(GUILD_A, [USER_1, USER_2], MOD_ID, null);
      if (!linked.ok) {
        throw new Error("setup failed");
      }

      const result = await repo.findIdentityById(
        GUILD_A,
        linked.val.identity.identity.id,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val?.members).toHaveLength(2);
      }
    });

    test("returns null for a nonexistent identity", async () => {
      const result = await repo.findIdentityById(GUILD_A, 999999);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val).toBeNull();
      }
    });
  });
});
