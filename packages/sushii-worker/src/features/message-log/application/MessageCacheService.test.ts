import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { MessageLogBlock } from "../domain/entities/MessageLogBlock";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type { GuildMessageCreatePayload } from "../domain/types/GuildMessagePayloads";
import { MessageCacheService } from "./MessageCacheService";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";

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

  const save = mock(async () => undefined);
  const events = { save } as unknown as MessageLogEventRepository;
  const blocks = {
    findByGuildAndChannel: mock(async () =>
      opts.blocked ? ({} as MessageLogBlock) : null,
    ),
  } as unknown as MessageLogBlockRepository;
  const guildConfigs = {
    findByGuildId: mock(async () => config),
  } as unknown as GuildConfigRepository;

  const service = new MessageCacheService(
    events,
    blocks,
    guildConfigs,
    pino({ level: "silent" }),
    opts.screening,
  );

  return { service, save };
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

  test("never caches bot messages", async () => {
    const screening = mock(async () => true);
    const { service, save } = setup({ messageLog: true, screening });

    await service.handleRawMessageCreate(payload(true));

    expect(save).not.toHaveBeenCalled();
  });
});
