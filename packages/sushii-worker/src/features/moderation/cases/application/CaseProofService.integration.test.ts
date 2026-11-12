import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import type { ProofRemoveResult } from "@/features/moderation/shared/application/ModLogMessageService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { DrizzleCaseProofRepository } from "@/features/moderation/shared/infrastructure/repositories/DrizzleCaseProofRepository";
import { DrizzleModLogRepository } from "@/features/moderation/shared/infrastructure/repositories/DrizzleModLogRepository";
import {
  modLogProofsInAppPublic,
  modLogsInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { CaseProofService } from "./CaseProofService";

const GUILD_ID = "111111111111111111";
const CASE_ID = "7";
const USER_ID = "222222222222222222";
const MOD_ID = "444444444444444444";
const OTHER_MOD_ID = "555555555555555555";

const ITEMS = [
  { content: "🗑️ Deleted in #general · https://discord.com/channels/1/2/3" },
  { content: "💬 Recent in #memes · https://discord.com/channels/1/4/5" },
  { content: "🛡️ AutoMod alert · https://discord.com/channels/1/6/7" },
];

describe("CaseProofService suggested proof (Integration)", () => {
  const logger = pino({ level: "silent" });
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let proofRepo: DrizzleCaseProofRepository;
  let failOnCall: number | null;
  let removeCalls: number;

  function makeService() {
    const removeProof = mock(
      async (
        moderationCase: ModerationCase,
        proofId: string,
      ): Promise<ProofRemoveResult> => {
        removeCalls++;
        if (removeCalls === failOnCall) {
          return "failed";
        }
        const removed = await proofRepo.remove(moderationCase.guildId, proofId);
        return removed ? "removed" : "already_removed";
      },
    );
    const placeUnhostedText = mock(async () => "updated" as const);
    const service = new CaseProofService({
      modLogRepository: new DrizzleModLogRepository(db, logger),
      caseProofRepository: proofRepo,
      modLogMessageService: {
        hostProof: mock(async () => {
          throw new Error("not used");
        }),
        removeProof,
        placeUnhostedText,
      },
      responseRegistry: { markStale: mock(async () => undefined) },
      proofChangeListener: { proofChanged: mock(() => undefined) },
      metrics: {
        recordProofAdded: mock(() => undefined),
        recordProofUndone: mock(() => undefined),
      },
      logger,
    });
    return { service, removeProof, placeUnhostedText };
  }

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    proofRepo = new DrizzleCaseProofRepository(db);
  });

  beforeEach(async () => {
    failOnCall = null;
    removeCalls = 0;
    await db.delete(modLogProofsInAppPublic);
    await db.delete(modLogsInAppPublic);
    await db.insert(modLogsInAppPublic).values({
      guildId: BigInt(GUILD_ID),
      caseId: BigInt(CASE_ID),
      action: "ban",
      actionTime: new Date("2026-11-11T12:00:00Z"),
      pending: false,
      userId: BigInt(USER_ID),
      userTag: "user",
      executorId: BigInt(MOD_ID),
    });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  async function addBatch(
    service: CaseProofService,
    items = ITEMS,
  ): Promise<string> {
    const result = await service.addSuggestions({
      guildId: GUILD_ID,
      caseId: CASE_ID,
      authorId: MOD_ID,
      items,
    });
    return result.unwrap().batchId;
  }

  test("add stores one row per item under one batch id", async () => {
    const { service, placeUnhostedText } = makeService();

    const batchId = await addBatch(service);

    const rows = await proofRepo.listByCase(GUILD_ID, CASE_ID);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.content)).toEqual(ITEMS.map((i) => i.content));
    for (const row of rows) {
      expect(row).toMatchObject({
        batchId,
        source: "suggestion",
        authorId: MOD_ID,
        attachments: [],
        hostMessageId: null,
      });
    }
    expect(placeUnhostedText).toHaveBeenCalledTimes(1);
  });

  test("undo removes exactly that batch", async () => {
    const { service } = makeService();
    const first = await addBatch(service);
    const second = await addBatch(service, [{ content: "kept" }]);

    const result = await service.undoBatch({
      guildId: GUILD_ID,
      caseId: CASE_ID,
      batchId: first,
      actorId: MOD_ID,
    });

    expect(result.ok).toBe(true);
    const rows = await proofRepo.listByCase(GUILD_ID, CASE_ID);
    expect(rows.map((r) => r.content)).toEqual(["kept"]);
    expect(rows[0].batchId).toBe(second);
  });

  test("another mod's undo is refused and removes nothing", async () => {
    const { service, removeProof } = makeService();
    const batchId = await addBatch(service);

    const result = await service.undoBatch({
      guildId: GUILD_ID,
      caseId: CASE_ID,
      batchId,
      actorId: OTHER_MOD_ID,
    });

    expect(result.val).toEqual({ kind: "not_allowed" });
    expect(removeProof).not.toHaveBeenCalled();
    expect(await proofRepo.listByCase(GUILD_ID, CASE_ID)).toHaveLength(3);
  });

  test("a partial removal is reported with what's left", async () => {
    const { service } = makeService();
    const batchId = await addBatch(service);
    failOnCall = 2;

    const result = await service.undoBatch({
      guildId: GUILD_ID,
      caseId: CASE_ID,
      batchId,
      actorId: MOD_ID,
    });

    expect(result.val).toEqual({ kind: "failed", removed: 1, remaining: 2 });
    expect(
      await proofRepo.listByBatch(GUILD_ID, CASE_ID, batchId),
    ).toHaveLength(2);
  });

  test("undoing a batch that's already gone", async () => {
    const { service } = makeService();
    const batchId = await addBatch(service);
    const input = {
      guildId: GUILD_ID,
      caseId: CASE_ID,
      batchId,
      actorId: MOD_ID,
    };
    await service.undoBatch(input);

    const again = await service.undoBatch(input);

    expect(again.val).toEqual({ kind: "gone" });
  });
});
