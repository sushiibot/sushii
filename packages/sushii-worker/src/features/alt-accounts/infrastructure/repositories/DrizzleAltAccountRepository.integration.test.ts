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

  describe("link", () => {
    test("creates a new identity when neither account is linked", async () => {
      const result = await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, "same person");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.kind).toBe("created");
        expect(result.val.identity.members).toHaveLength(2);
      }
    });

    test("adds to an existing identity when one account is already linked", async () => {
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
      const result = await repo.link(GUILD_A, USER_1, USER_3, MOD_ID, null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.kind).toBe("added");
        if (result.val.kind === "added") {
          expect(result.val.addedUserId).toBe(USER_3);
        }
        expect(result.val.identity.members).toHaveLength(3);
      }
    });

    test("returns 'alreadyLinked' when both accounts share an identity", async () => {
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
      const result = await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.kind).toBe("alreadyLinked");
      }
    });

    test("merges two different identities", async () => {
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
      await repo.link(GUILD_A, USER_3, "666666666666666666", MOD_ID, null);

      const result = await repo.link(GUILD_A, USER_1, USER_3, MOD_ID, null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.kind).toBe("merged");
        if (result.val.kind === "merged") {
          expect(result.val.identity.members).toHaveLength(4);
        }
      }
    });

    test("merge keeps the only nickname when just one identity has one", async () => {
      const first = await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
      const second = await repo.link(
        GUILD_A,
        USER_3,
        "666666666666666666",
        MOD_ID,
        null,
      );
      if (!first.ok || !second.ok) {
        throw new Error("setup failed");
      }

      await repo.setNickname(GUILD_A, second.val.identity.identity.id, "Named Group");

      const merged = await repo.link(GUILD_A, USER_1, USER_3, MOD_ID, null);

      expect(merged.ok).toBe(true);
      if (merged.ok && merged.val.kind === "merged") {
        expect(merged.val.identity.identity.nickname).toBe("Named Group");
      }
    });

    test("scopes identities per guild", async () => {
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);

      const guildBResult = await repo.findIdentityByUserId(GUILD_B, USER_1);
      expect(guildBResult.ok).toBe(true);
      if (guildBResult.ok) {
        expect(guildBResult.val).toBeNull();
      }
    });
  });

  describe("removeMember", () => {
    test("removes one member without deleting the identity when others remain", async () => {
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);

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
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
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
      const pair = await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
      const trio = await repo.link(GUILD_A, USER_3, "666666666666666666", MOD_ID, null);
      if (!trio.ok) {
        throw new Error("setup failed");
      }
      await repo.link(
        GUILD_A,
        "666666666666666666",
        "777777777777777777",
        MOD_ID,
        null,
      );

      const result = await repo.listIdentities(GUILD_A, 10, 0);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.map((i) => i.memberCount)).toEqual([3, 2]);
        expect(result.val.map((i) => i.memberIds.length)).toEqual([3, 2]);
      }
      expect(pair.ok).toBe(true);
    });

    test("includes member IDs for each identity", async () => {
      await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);

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
      const linked = await repo.link(GUILD_A, USER_1, USER_2, MOD_ID, null);
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
