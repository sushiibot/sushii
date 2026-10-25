import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { Events } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { SCREENING_DEFAULTS } from "./domain/types";
import { ScreeningAutomodHandler } from "./presentation/events/ScreeningAutomodHandler";
import { ScreeningMessageHandler } from "./presentation/events/ScreeningMessageHandler";
import { setupMemberScreeningFeature } from "./setup";

const logger = pino({ level: "silent" });

describe("setupMemberScreeningFeature", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;

  const client = {} as Client;
  const deploymentService = {} as DeploymentService;
  const moderationService = { executeAction: mock() };

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
  });

  afterAll(async () => {
    await testDb.close();
  });

  function setup(openRouterApiKey?: string) {
    return setupMemberScreeningFeature({
      client,
      db,
      logger,
      deploymentService,
      moderationService,
      openRouterApiKey,
    });
  }

  test("registers every handler with an API key", () => {
    const feature = setup("test-key");

    expect(feature.commands).toHaveLength(1);
    expect(feature.commands[0].registeredGuilds).toEqual([
      "418504865543749642",
    ]);
    expect(feature.buttonHandlers).toHaveLength(1);
    expect(feature.selectMenuHandlers).toHaveLength(1);
    expect(feature.tasks).toHaveLength(1);
    expect(feature.eventHandlers).toHaveLength(4);
    expect(
      feature.eventHandlers.map((h): string => h.eventType).sort(),
    ).toEqual(
      [
        Events.GuildAuditLogEntryCreate,
        Events.Raw,
        Events.Raw,
        Events.AutoModerationActionExecution,
      ].sort(),
    );
  });

  test("skips message and automod screening without an API key", () => {
    const feature = setup(undefined);

    expect(feature.commands).toHaveLength(1);
    expect(feature.buttonHandlers).toHaveLength(1);
    expect(feature.selectMenuHandlers).toHaveLength(1);
    expect(feature.tasks).toHaveLength(1);
    expect(feature.eventHandlers).toHaveLength(2);
    expect(
      feature.eventHandlers.some(
        (h) =>
          h instanceof ScreeningMessageHandler ||
          h instanceof ScreeningAutomodHandler,
      ),
    ).toBe(false);
  });

  test("caches messages only for screened guilds", async () => {
    const feature = setup("test-key");
    const guildId = "100000000000000001";

    expect(await feature.services.shouldCacheForScreening(guildId)).toBe(false);

    await feature.services.guildRepository.upsert({
      guildId,
      logChannelId: null,
      ...SCREENING_DEFAULTS,
      rules: null,
      enabledBy: "400000000000000001",
      enabledAt: new Date("2026-03-01T00:00:00Z"),
    });

    expect(await feature.services.shouldCacheForScreening(guildId)).toBe(true);
  });

  test("doesn't cache for screened guilds without an API key", async () => {
    const guildId = "100000000000000002";
    const feature = setup(undefined);
    await feature.services.guildRepository.upsert({
      guildId,
      logChannelId: null,
      ...SCREENING_DEFAULTS,
      rules: null,
      enabledBy: "400000000000000001",
      enabledAt: new Date("2026-03-01T00:00:00Z"),
    });

    expect(await feature.services.shouldCacheForScreening(guildId)).toBe(false);
  });

  test("resolves false when the settings lookup fails", async () => {
    const failingDb = {
      select: () => {
        throw new Error("connection refused");
      },
    } as unknown as NodePgDatabase<typeof schema>;
    const feature = setupMemberScreeningFeature({
      client,
      db: failingDb,
      logger,
      deploymentService,
      moderationService,
      openRouterApiKey: "test-key",
    });

    expect(
      await feature.services.shouldCacheForScreening("100000000000000001"),
    ).toBe(false);
  });
});
