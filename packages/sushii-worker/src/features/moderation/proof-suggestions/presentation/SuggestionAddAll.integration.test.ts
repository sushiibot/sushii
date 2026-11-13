import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { ChannelType } from "discord.js";
import pino from "pino";

import type { MessageData } from "@/features/message-log/domain/types/MessageData";
import { DrizzleMessageLogBlockRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogBlockRepository";
import { DrizzleMessageLogPostRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogPostRepository";
import { CaseProofService } from "@/features/moderation/cases/application/CaseProofService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { DrizzleCaseProofRepository } from "@/features/moderation/shared/infrastructure/repositories/DrizzleCaseProofRepository";
import { DrizzleModLogRepository } from "@/features/moderation/shared/infrastructure/repositories/DrizzleModLogRepository";
import {
  messageLogPostsInAppPublic,
  messagesInAppPublic,
  modLogProofsInAppPublic,
  modLogsInAppPublic,
} from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { ProofSuggestionService } from "../application/ProofSuggestionService";
import { viewerAccessFromMember } from "../application/viewerAccess";
import { NOOP_PROOF_SUGGESTION_METRICS } from "../domain/ProofSuggestionMetrics";
import { DrizzleProofSuggestionMessageRepository } from "../infrastructure/DrizzleProofSuggestionMessageRepository";
import { ProofSuggestionButtonHandler } from "./ProofSuggestionButtonHandler";
import { SuggestionFlow } from "./SuggestionFlow";
import { buildAddAllId } from "./customIds";

const GUILD = "100000000000000001";
const GENERAL = "300000000000000001";
const LOG = "300000000000000009";
const TARGET = "200000000000000001";
const MOD = "200000000000000005";
const CASE_ID = "12";
const ACTION_TIME = new Date(Date.UTC(2026, 10, 10, 18, 30));

function minutesBefore(minutes: number): Date {
  return new Date(ACTION_TIME.getTime() - minutes * 60_000);
}

/** A mod who can see and read every channel. */
function member() {
  const channel = (id: string) => ({
    id,
    name: id === LOG ? "message-log" : "general",
    type: ChannelType.GuildText,
  });
  return {
    id: MOD,
    guild: { channels: { resolve: (id: string) => channel(id) } },
    permissionsIn: () => ({ has: () => true }),
  };
}

function clicked(customId: string, message: { components: unknown[] }) {
  return {
    customId,
    guildId: GUILD,
    user: { id: MOD },
    member: member(),
    message: {
      id: "900000000000000000",
      createdTimestamp: Date.now(),
      ...message,
    },
    inCachedGuild: () => true,
    memberPermissions: { any: () => true },
    reply: mock(async (_o: unknown) => undefined),
    deferReply: mock(async (_o: unknown) => undefined),
    deferUpdate: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
    followUp: mock(async (_o: unknown) => undefined),
  };
}

describe("Add all suggested proof (Postgres)", () => {
  const logger = pino({ level: "silent" });
  const testDb = new PostgresTestDatabase();
  let db: Awaited<ReturnType<PostgresTestDatabase["initialize"]>>;
  let proofRepo: DrizzleCaseProofRepository;
  let flow: SuggestionFlow;
  let handler: ProofSuggestionButtonHandler;

  beforeAll(async () => {
    db = await testDb.initialize();
    proofRepo = new DrizzleCaseProofRepository(db);
    const modLogRepository = new DrizzleModLogRepository(db, logger);
    const guildConfigs = {
      findByGuildId: async (guildId: string) => {
        const config = GuildConfig.createDefault(guildId);
        config.loggingSettings.messageLogEnabled = true;
        config.loggingSettings.messageLogChannel = LOG;
        return config;
      },
      save: async (config: GuildConfig) => config,
    };

    const suggestions = new ProofSuggestionService({
      messages: new DrizzleProofSuggestionMessageRepository(db),
      logPosts: new DrizzleMessageLogPostRepository(db),
      logBlocks: new DrizzleMessageLogBlockRepository(db, logger),
      guildConfigs,
      existence: {
        checkMany: async (_channelId, ids) =>
          new Map(ids.map((i) => [i, "exists" as const])),
      },
      logger,
    });

    const caseProofService = new CaseProofService({
      modLogRepository,
      caseProofRepository: proofRepo,
      modLogMessageService: {
        hostProof: mock(async () => {
          throw new Error("not used");
        }),
        removeProof: async (moderationCase: ModerationCase, proofId: string) =>
          (await proofRepo.remove(moderationCase.guildId, proofId))
            ? ("removed" as const)
            : ("already_removed" as const),
        placeUnhostedText: async () => "updated" as const,
      },
      responseRegistry: { markStale: async () => undefined },
      proofChangeListener: { proofChanged: () => undefined },
      metrics: {
        recordProofAdded: () => undefined,
        recordProofUndone: () => undefined,
      },
      logger,
    });

    flow = new SuggestionFlow({
      caseProofRepository: proofRepo,
      suggestions,
      renderer: { render: async () => ({}) as never },
      caseProofService,
      modLogRepository,
      metrics: NOOP_PROOF_SUGGESTION_METRICS,
      logger,
    });

    handler = new ProofSuggestionButtonHandler({
      flow,
      response: {
        modLogRepository,
        caseProofRepository: proofRepo,
        guildConfigRepository: guildConfigs,
        emojiRepository: { getEmojis: async () => ({}) as never },
      },
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(modLogProofsInAppPublic);
    await db.delete(modLogsInAppPublic);
    await db.delete(messagesInAppPublic);
    await db.delete(messageLogPostsInAppPublic);

    await db.insert(modLogsInAppPublic).values({
      guildId: BigInt(GUILD),
      caseId: BigInt(CASE_ID),
      action: "warn",
      actionTime: ACTION_TIME,
      pending: false,
      userId: BigInt(TARGET),
      userTag: "spambot",
      executorId: BigInt(MOD),
    });
  });

  async function cacheMessage(id: string, at: Date, content: string) {
    const msg: MessageData = {
      id,
      channel_id: GENERAL,
      type: 0,
      author: {
        id: TARGET,
        username: "spambot",
        discriminator: "0",
        avatar: null,
        bot: false,
        global_name: null,
      },
      content,
      timestamp: at.toISOString(),
    };
    await db.insert(messagesInAppPublic).values({
      messageId: BigInt(id),
      guildId: BigInt(GUILD),
      channelId: BigInt(GENERAL),
      authorId: BigInt(TARGET),
      created: at.toISOString(),
      content,
      msg,
      interactionUserId: null,
    });
  }

  test("cached messages and log posts become link-only rows that Undo removes", async () => {
    await cacheMessage(
      "500000000000000001",
      minutesBefore(6),
      "FREE NITRO here",
    );
    await cacheMessage("500000000000000002", minutesBefore(4), "claim it now");
    // Both deletes landed in one bulk delete post.
    await new DrizzleMessageLogPostRepository(db).saveMany(
      ["500000000000000001", "500000000000000002"].map((messageId) => ({
        messageId,
        guildId: GUILD,
        channelId: GENERAL,
        logChannelId: LOG,
        logMessageId: "600000000000000001",
      })),
    );

    const moderationCase = await flow.loadCase(GUILD, CASE_ID);
    if (!moderationCase) {
      throw new Error("Case fixture missing");
    }
    const access = viewerAccessFromMember(member() as never);
    const current = await flow.compute(moderationCase, access);
    expect(current.map((s) => s.kind)).toEqual(["deleted"]);

    const addAll = clicked(buildAddAllId(CASE_ID, flow.fingerprint(current)), {
      components: [],
    });
    await handler.handleInteraction(addAll as unknown as ButtonInteraction);

    const rows = await proofRepo.listByCase(GUILD, CASE_ID);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.source).toBe("suggestion");
    expect(row.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.attachments).toEqual([]);
    expect(row.content).toBe(
      `🗑️ 2 deleted messages in <#${GENERAL}> · https://discord.com/channels/${GUILD}/${LOG}/600000000000000001`,
    );
    expect(row.content).not.toContain("FREE NITRO");
    expect(await flow.compute(moderationCase, access)).toEqual([]);
    const duplicate = clicked(
      buildAddAllId(CASE_ID, flow.fingerprint(current)),
      { components: [] },
    );
    await handler.handleInteraction(duplicate as unknown as ButtonInteraction);
    expect(JSON.stringify(duplicate.followUp.mock.calls)).toContain(
      "Already added.",
    );
    const retry = await flow.add({
      moderationCase,
      chosen: current,
      authorId: MOD,
      surface: "review",
    });
    expect(retry.kind).toBe("already_added");
    expect(await proofRepo.listByCase(GUILD, CASE_ID)).toHaveLength(1);

    const added = addAll.followUp.mock.calls[0][0] as {
      components: { toJSON(): unknown }[];
    };
    const addedJson = JSON.stringify(added.components.map((c) => c.toJSON()));
    expect(addedJson).toContain("(1 link)");
    const undoId = /proof\/suggest\/undo\/[^"]+/.exec(addedJson)?.[0];
    expect(undoId).toBe(`proof/suggest/undo/${CASE_ID}/${row.batchId}`);

    const undo = clicked(undoId ?? "", {
      components: added.components.map((c) => {
        const data = c.toJSON();
        return { toJSON: () => data };
      }),
    });
    await handler.handleInteraction(undo as unknown as ButtonInteraction);

    expect(await proofRepo.listByCase(GUILD, CASE_ID)).toEqual([]);
    expect(await flow.compute(moderationCase, access)).toHaveLength(1);
    expect(JSON.stringify(undo.editReply.mock.calls[0][0])).toContain(
      `Undone. Removed 1 link from Case #${CASE_ID}.`,
    );
  });
  test("two concurrent pickers save a link only once", async () => {
    await cacheMessage("500000000000000001", minutesBefore(6), "spam");
    const moderationCase = await flow.loadCase(GUILD, CASE_ID);
    if (!moderationCase) {
      throw new Error("Case fixture missing");
    }
    const chosen = await flow.compute(
      moderationCase,
      viewerAccessFromMember(member() as never),
    );
    const input = {
      moderationCase,
      chosen,
      authorId: MOD,
      surface: "review" as const,
    };
    const results = await Promise.all([flow.add(input), flow.add(input)]);
    expect(results.map((result) => result.kind)).toEqual([
      "added",
      "already_added",
    ]);
    expect(await proofRepo.listByCase(GUILD, CASE_ID)).toHaveLength(1);
  });
});
