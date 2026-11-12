import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { MessageLogBlock } from "../domain/entities/MessageLogBlock";
import type { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type {
  GuildMessageCreatePayload,
  GuildMessageUpdatePayload,
} from "../domain/types/GuildMessagePayloads";
import type { MessageLogMetrics } from "../infrastructure/MessageLogMetrics";
import { MessageCacheService } from "./MessageCacheService";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const SUSHII = "400000000000000001";
const OTHER_BOT = "400000000000000002";
const TRIGGERING_USER = "200000000000000002";

function payload(bot = false): GuildMessageCreatePayload {
  return {
    id: "500000000000000001",
    guild_id: GUILD,
    channel_id: CHANNEL,
    author: {
      id: "200000000000000001",
      username: "member",
      discriminator: "0",
      avatar: null,
      global_name: null,
      bot,
    },
    content: "hello",
    timestamp: "2026-03-10T12:00:00.000Z",
  } as unknown as GuildMessageCreatePayload;
}

function setup(opts: {
  messageLog: boolean;
  blocked?: boolean;
  screening?: (guildId: string) => Promise<boolean>;
}) {
  const config = GuildConfig.createDefault(GUILD);
  config.loggingSettings.messageLogEnabled = opts.messageLog;
  config.loggingSettings.messageLogChannel = opts.messageLog
    ? "300000000000000009"
    : null;

  const save = mock(async (_event: MessageLogEvent) => undefined);
  const updateIfChanged = mock(async (_event: MessageLogEvent) => true);
  const events = {
    save,
    updateIfChanged,
  } as unknown as MessageLogEventRepository;
  const add = mock(() => undefined);
  const metrics = {
    interactionCached: { add },
  } as unknown as MessageLogMetrics;
  const blocks = {
    findByGuildAndChannel: mock(async () =>
      opts.blocked ? ({} as MessageLogBlock) : null,
    ),
  } as unknown as MessageLogBlockRepository;
  const findByGuildId = mock(async () => config);
  const guildConfigs = { findByGuildId } as unknown as GuildConfigRepository;

  const service = new MessageCacheService(
    events,
    blocks,
    guildConfigs,
    () => SUSHII,
    metrics,
    pino({ level: "silent" }),
    opts.screening,
  );

  return { service, save, updateIfChanged, add, findByGuildId };
}

describe("MessageCacheService", () => {
  test("caches when message logging is enabled without asking screening", async () => {
    const screening = mock(async () => false);
    const { service, save } = setup({ messageLog: true, screening });

    await service.handleRawMessageCreate(payload());

    expect(save).toHaveBeenCalledTimes(1);
    expect(screening).not.toHaveBeenCalled();
  });

  test("skips when message logging is off and no screening predicate is given", async () => {
    const { service, save } = setup({ messageLog: false });

    await service.handleRawMessageCreate(payload());

    expect(save).not.toHaveBeenCalled();
  });

  test("caches for a screened guild when message logging is off", async () => {
    const screening = mock(async () => true);
    const { service, save } = setup({ messageLog: false, screening });

    await service.handleRawMessageUpdate(payload());

    expect(screening).toHaveBeenCalledWith(GUILD);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("skips when neither message logging nor screening applies", async () => {
    const { service, save } = setup({
      messageLog: false,
      screening: async () => false,
    });

    await service.handleRawMessageCreate(payload());

    expect(save).not.toHaveBeenCalled();
  });

  test("still respects blocked channels for screened guilds", async () => {
    const { service, save } = setup({
      messageLog: false,
      blocked: true,
      screening: async () => true,
    });

    await service.handleRawMessageCreate(payload());

    expect(save).not.toHaveBeenCalled();
  });

  test("never caches bot messages without interaction metadata", async () => {
    const screening = mock(async () => true);
    const { service, save } = setup({ messageLog: true, screening });

    await service.handleRawMessageCreate(payload(true));

    expect(save).not.toHaveBeenCalled();
  });

  test("skips bot messages and edits without interaction metadata before any query", async () => {
    const { service, save, findByGuildId } = setup({ messageLog: true });

    await service.handleRawMessageCreate(botReply(OTHER_BOT, false));
    await service.handleRawMessageUpdate(botReply(OTHER_BOT, false));

    expect(save).not.toHaveBeenCalled();
    expect(findByGuildId).not.toHaveBeenCalled();
  });

  test("skips sushii's own interaction replies before any query", async () => {
    const { service, save, findByGuildId } = setup({ messageLog: true });

    await service.handleRawMessageCreate(botReply(SUSHII, true));
    await service.handleRawMessageUpdate(botReply(SUSHII, true));

    expect(save).not.toHaveBeenCalled();
    expect(findByGuildId).not.toHaveBeenCalled();
  });

  test("caches another bot's interaction reply with the triggering user", async () => {
    const { service, save, add } = setup({ messageLog: true });

    await service.handleRawMessageCreate(botReply(OTHER_BOT, true));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: OTHER_BOT,
        discordMessage: expect.objectContaining({
          interaction_metadata: expect.objectContaining({
            user_id: TRIGGERING_USER,
          }),
        }),
      }),
    );
    expect(add).toHaveBeenCalledWith(1);
  });

  test("interaction reply edits only update an existing row and are not counted", async () => {
    const { service, save, updateIfChanged, add } = setup({
      messageLog: true,
    });

    await service.handleRawMessageUpdate(botReply(OTHER_BOT, true));

    expect(save).not.toHaveBeenCalled();
    expect(updateIfChanged).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  test("member edits keep using the upsert", async () => {
    const { service, save, updateIfChanged } = setup({ messageLog: true });

    await service.handleRawMessageUpdate(payload());

    expect(save).toHaveBeenCalledTimes(1);
    expect(updateIfChanged).not.toHaveBeenCalled();
  });

  test("interaction reply edits still respect blocked channels", async () => {
    const { service, save, updateIfChanged } = setup({
      messageLog: true,
      blocked: true,
    });

    await service.handleRawMessageUpdate(botReply(OTHER_BOT, true));

    expect(save).not.toHaveBeenCalled();
    expect(updateIfChanged).not.toHaveBeenCalled();
  });

  test("skips bot messages before the client is ready", async () => {
    const config = GuildConfig.createDefault(GUILD);
    config.loggingSettings.messageLogEnabled = true;
    config.loggingSettings.messageLogChannel = "300000000000000009";
    const save = mock(async () => undefined);
    const service = new MessageCacheService(
      { save } as unknown as MessageLogEventRepository,
      {
        findByGuildAndChannel: mock(async () => null),
      } as unknown as MessageLogBlockRepository,
      {
        findByGuildId: mock(async () => config),
      } as unknown as GuildConfigRepository,
      () => undefined,
      {
        interactionCached: { add: () => undefined },
      } as unknown as MessageLogMetrics,
      pino({ level: "silent" }),
    );

    await service.handleRawMessageCreate(botReply(OTHER_BOT, true));

    expect(save).not.toHaveBeenCalled();
  });
});

function botReply(
  authorId: string,
  withMetadata: boolean,
): GuildMessageCreatePayload & GuildMessageUpdatePayload {
  return {
    ...payload(true),
    author: {
      id: authorId,
      username: "app",
      discriminator: "0",
      avatar: null,
      global_name: null,
      bot: true,
    },
    content: "done thinking",
    interaction_metadata: withMetadata
      ? {
          id: "600000000000000001",
          type: 2,
          user: { id: TRIGGERING_USER },
          authorizing_integration_owners: { "1": TRIGGERING_USER },
        }
      : undefined,
  } as unknown as GuildMessageCreatePayload & GuildMessageUpdatePayload;
}
