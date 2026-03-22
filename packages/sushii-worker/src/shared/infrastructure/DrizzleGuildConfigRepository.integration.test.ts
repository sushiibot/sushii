import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { pino } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import { guildConfigsInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { GuildConfig } from "../domain/entities/GuildConfig";
import { DrizzleGuildConfigRepository } from "./DrizzleGuildConfigRepository";

describe("DrizzleGuildConfigRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleGuildConfigRepository;
  let logger: Logger;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    logger = pino({ level: "silent" }); // Silent logger for tests
    repo = new DrizzleGuildConfigRepository(db, logger);
  });

  beforeEach(async () => {
    // Clear tables before each test to ensure isolation
    await db.delete(guildConfigsInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("returns default configuration when guild not found", async () => {
    const guildId = "123456789";

    const config = await repo.findByGuildId(guildId);

    expect(config.guildId).toBe(guildId);
    expect(config.prefix).toBe(null);
    expect(config.messageSettings.joinMessage).toBe(null);
    expect(config.messageSettings.joinMessageEnabled).toBe(true);
    expect(config.loggingSettings.modLogEnabled).toBe(true);
    expect(config.moderationSettings.timeoutCommandDmEnabled).toBe(true);
    expect(config.disabledChannels).toEqual([]);
  });

  test("saves and retrieves guild configuration correctly", async () => {
    const guildId = "123456789";
    const config = new GuildConfig(
      guildId,
      "!",
      {
        joinMessage: "Welcome {user}!",
        joinMessageEnabled: true,
        leaveMessage: "Goodbye {user}",
        leaveMessageEnabled: false,
        messageChannel: "999888777",
      },
      {
        modLogChannel: "111222333",
        modLogEnabled: true,
        memberLogChannel: "444555666",
        memberLogEnabled: false,
        messageLogChannel: "777888999",
        messageLogEnabled: true,
        reactionLogChannel: "111000111",
        reactionLogEnabled: true,
      },
      {
        timeoutDmText: "You have been muted",
        timeoutCommandDmEnabled: true,
        timeoutNativeDmEnabled: true,
        warnDmText: "Warning!",
        banDmText: null,
        banDmEnabled: true,
        kickDmText: null,
        kickDmEnabled: false,
        lookupDetailsOptIn: true,
        lookupPrompted: false,
        automodSpamEnabled: false,
        automodAlertsChannelId: null,
      },
      ["123", "456", "789"],
    );

    const savedConfig = await repo.save(config);
    const retrievedConfig = await repo.findByGuildId(guildId);

    // Verify saved config
    expect(savedConfig.guildId).toBe(guildId);
    expect(savedConfig.prefix).toBe("!");
    expect(savedConfig.messageSettings.joinMessage).toBe("Welcome {user}!");
    expect(savedConfig.messageSettings.joinMessageEnabled).toBe(true);
    expect(savedConfig.loggingSettings.modLogChannel).toBe("111222333");
    expect(savedConfig.loggingSettings.modLogEnabled).toBe(true);
    expect(savedConfig.moderationSettings.timeoutCommandDmEnabled).toBe(true);
    expect(savedConfig.disabledChannels).toEqual(["123", "456", "789"]);

    // Verify retrieved config matches
    expect(retrievedConfig).toEqual(savedConfig);
  });

  test("updates existing configuration on conflict", async () => {
    const guildId = "123456789";

    // Save initial config
    const initialConfig = new GuildConfig(
      guildId,
      "?",
      {
        joinMessage: "Initial message",
        joinMessageEnabled: false,
        leaveMessage: null,
        leaveMessageEnabled: false,
        messageChannel: null,
      },
      {
        modLogChannel: null,
        modLogEnabled: false,
        memberLogChannel: null,
        memberLogEnabled: false,
        messageLogChannel: null,
        messageLogEnabled: false,
        reactionLogChannel: null,
        reactionLogEnabled: false,
      },
      {
        timeoutDmText: null,
        timeoutCommandDmEnabled: false,
        timeoutNativeDmEnabled: false,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: false,
        kickDmText: null,
        kickDmEnabled: false,
        lookupDetailsOptIn: false,
        lookupPrompted: false,
        automodSpamEnabled: false,
        automodAlertsChannelId: null,
      },
      [],
    );

    await repo.save(initialConfig);

    // Update with new config
    const updatedConfig = new GuildConfig(
      guildId,
      "!",
      {
        joinMessage: "Updated message",
        joinMessageEnabled: true,
        leaveMessage: "Bye!",
        leaveMessageEnabled: true,
        messageChannel: "123456",
      },
      {
        modLogChannel: "789012",
        modLogEnabled: true,
        memberLogChannel: null,
        memberLogEnabled: false,
        messageLogChannel: null,
        messageLogEnabled: false,
        reactionLogChannel: null,
        reactionLogEnabled: false,
      },
      {
        timeoutDmText: "Muted!",
        timeoutCommandDmEnabled: true,
        timeoutNativeDmEnabled: true,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: true,
        kickDmText: null,
        kickDmEnabled: false,
        lookupDetailsOptIn: true,
        lookupPrompted: true,
        automodSpamEnabled: false,
        automodAlertsChannelId: null,
      },
      ["999"],
    );

    const savedConfig = await repo.save(updatedConfig);
    const retrievedConfig = await repo.findByGuildId(guildId);

    expect(savedConfig.prefix).toBe("!");
    expect(savedConfig.messageSettings.joinMessage).toBe("Updated message");
    expect(savedConfig.messageSettings.joinMessageEnabled).toBe(true);
    expect(savedConfig.loggingSettings.modLogChannel).toBe("789012");
    expect(savedConfig.moderationSettings.timeoutDmText).toBe("Muted!");
    expect(savedConfig.disabledChannels).toEqual(["999"]);

    expect(retrievedConfig).toEqual(savedConfig);
  });

  test("handles null values correctly", async () => {
    const guildId = "123456789";
    const config = new GuildConfig(
      guildId,
      null,
      {
        joinMessage: null,
        joinMessageEnabled: false,
        leaveMessage: null,
        leaveMessageEnabled: false,
        messageChannel: null,
      },
      {
        modLogChannel: null,
        modLogEnabled: false,
        memberLogChannel: null,
        memberLogEnabled: false,
        messageLogChannel: null,
        messageLogEnabled: false,
        reactionLogChannel: null,
        reactionLogEnabled: false,
      },
      {
        timeoutDmText: null,
        timeoutCommandDmEnabled: false,
        timeoutNativeDmEnabled: false,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: false,
        kickDmText: null,
        kickDmEnabled: false,
        lookupDetailsOptIn: false,
        lookupPrompted: false,
        automodSpamEnabled: false,
        automodAlertsChannelId: null,
      },
      [],
    );

    const savedConfig = await repo.save(config);
    const retrievedConfig = await repo.findByGuildId(guildId);

    expect(savedConfig.prefix).toBe(null);
    expect(savedConfig.messageSettings.joinMessage).toBe(null);
    expect(savedConfig.messageSettings.messageChannel).toBe(null);
    expect(savedConfig.loggingSettings.modLogChannel).toBe(null);
    expect(savedConfig.moderationSettings.timeoutDmText).toBe(null);
    expect(savedConfig.disabledChannels).toEqual([]);

    expect(retrievedConfig).toEqual(savedConfig);
  });

  test("handles empty disabled channels array", async () => {
    const guildId = "123456789";
    const config = GuildConfig.createDefault(guildId);

    const savedConfig = await repo.save(config);
    const retrievedConfig = await repo.findByGuildId(guildId);

    expect(savedConfig.disabledChannels).toEqual([]);
    expect(retrievedConfig.disabledChannels).toEqual([]);
  });

  test("handles large disabled channels array", async () => {
    const guildId = "123456789";
    // Use valid Discord channel IDs (numeric strings) instead of strings like "channel0"
    const disabledChannels = Array.from(
      { length: 100 },
      (_, i) => `${1000000000000000000n + BigInt(i)}`,
    );

    const config = new GuildConfig(
      guildId,
      null,
      {
        joinMessage: null,
        joinMessageEnabled: false,
        leaveMessage: null,
        leaveMessageEnabled: false,
        messageChannel: null,
      },
      {
        modLogChannel: null,
        modLogEnabled: false,
        memberLogChannel: null,
        memberLogEnabled: false,
        messageLogChannel: null,
        messageLogEnabled: false,
        reactionLogChannel: null,
        reactionLogEnabled: false,
      },
      {
        timeoutDmText: null,
        timeoutCommandDmEnabled: false,
        timeoutNativeDmEnabled: false,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: false,
        kickDmText: null,
        kickDmEnabled: false,
        lookupDetailsOptIn: false,
        lookupPrompted: false,
        automodSpamEnabled: false,
        automodAlertsChannelId: null,
      },
      disabledChannels,
    );

    const savedConfig = await repo.save(config);
    const retrievedConfig = await repo.findByGuildId(guildId);

    expect(savedConfig.disabledChannels).toHaveLength(100);
    expect(retrievedConfig.disabledChannels).toEqual(disabledChannels);
  });

  test("should save and retrieve automod alerts channel ID", async () => {
    const guildId = "777000777000777000";
    const alertsChannelId = "888999888999888999";

    const config = new GuildConfig(
      guildId,
      null,
      {
        joinMessage: null,
        joinMessageEnabled: true,
        leaveMessage: null,
        leaveMessageEnabled: true,
        messageChannel: null,
      },
      {
        modLogChannel: null,
        modLogEnabled: true,
        memberLogChannel: null,
        memberLogEnabled: true,
        messageLogChannel: null,
        messageLogEnabled: true,
        reactionLogChannel: null,
        reactionLogEnabled: true,
      },
      {
        timeoutDmText: null,
        timeoutCommandDmEnabled: true,
        timeoutNativeDmEnabled: true,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: true,
        kickDmText: null,
        kickDmEnabled: false,
        lookupDetailsOptIn: false,
        lookupPrompted: false,
        automodSpamEnabled: true,
        automodAlertsChannelId: alertsChannelId,
      },
      [],
    );

    const savedConfig = await repo.save(config);
    const retrievedConfig = await repo.findByGuildId(guildId);

    expect(savedConfig.moderationSettings.automodAlertsChannelId).toBe(
      alertsChannelId,
    );
    expect(retrievedConfig.moderationSettings.automodAlertsChannelId).toBe(
      alertsChannelId,
    );

    // Verify clearing it works too
    const cleared = savedConfig.setAutomodAlertsChannel(null);
    const clearedConfig = await repo.save(cleared);
    expect(clearedConfig.moderationSettings.automodAlertsChannelId).toBeNull();
  });
});
