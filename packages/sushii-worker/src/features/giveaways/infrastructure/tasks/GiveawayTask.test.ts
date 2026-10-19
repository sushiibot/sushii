import { describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { ChannelType, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import { Err, Ok } from "ts-results";
import type { Result } from "ts-results";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { DrawResult } from "@/features/giveaways/application/GiveawayDrawService";
import type { GiveawayDrawService } from "@/features/giveaways/application/GiveawayDrawService";
import type { GiveawayEntryCacheService } from "@/features/giveaways/application/GiveawayEntryCacheService";
import type { GiveawayEntryService } from "@/features/giveaways/application/GiveawayEntryService";
import type { GiveawayService } from "@/features/giveaways/application/GiveawayService";
import { Giveaway } from "@/features/giveaways/domain/entities/Giveaway";

import type { GiveawayMetrics } from "../metrics/GiveawayMetrics";
import { GiveawayTask } from "./GiveawayTask";

// Guild IDs whose shard (for 2 shards) is 0 and 1 respectively
const GUILD_SHARD_0 = (2n << 22n).toString();
const GUILD_SHARD_1 = (1n << 22n).toString();
const CHANNEL_ID = "500";

function makeGiveaway(
  id: string,
  overrides: { guildId?: string; isEnded?: boolean } = {},
): Giveaway {
  return new Giveaway({
    id,
    channelId: CHANNEL_ID,
    guildId: overrides.guildId ?? GUILD_SHARD_0,
    hostUserId: "400",
    numWinners: 2,
    prize: "Prize",
    startAt: new Date(Date.now() - 120_000),
    endAt: new Date(Date.now() - 1_000),
    isEnded: overrides.isEnded ?? false,
  });
}

function makeChannel(type: ChannelType = ChannelType.GuildText) {
  return {
    id: CHANNEL_ID,
    guildId: GUILD_SHARD_0,
    type,
    isTextBased: () => true,
    isDMBased: () => false,
    messages: { edit: mock(async () => ({})) },
  };
}

function discordError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "error" },
    code,
    status,
    "GET",
    `/channels/${CHANNEL_ID}`,
    {},
  );
}

interface SetupOptions {
  giveaways?: Giveaway[];
  channel?: unknown;
  fetchChannel?: (id: string) => Promise<unknown>;
  guilds?: [string, { available: boolean }][];
  claim?: (id: string) => Promise<Result<Giveaway | null, string>>;
  drawWinners?: () => Promise<Result<DrawResult, string>>;
  hasUnflushedEntries?: (id: string) => boolean;
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = [];
  const giveaways = options.giveaways ?? [makeGiveaway("1")];
  const channel = options.channel ?? makeChannel();

  const client = {
    options: { shardCount: 2 },
    cluster: { shardList: [0] },
    guilds: {
      cache: new Map(options.guilds ?? [[GUILD_SHARD_0, { available: true }]]),
    },
    channels: {
      fetch: mock(
        options.fetchChannel ??
          (async () => {
            calls.push("fetchChannel");
            return channel;
          }),
      ),
    },
  } as unknown as Client;

  const deploymentService = {
    isCurrentDeploymentActive: () => true,
  } as unknown as DeploymentService;

  const claimGiveawayForEnding = mock(
    options.claim ??
      (async (id: string) => {
        calls.push(`claim:${id}`);
        const giveaway = giveaways.find((g) => g.id === id);
        return Ok(
          giveaway
            ? Giveaway.fromData({ ...giveaway.toData(), isEnded: true })
            : null,
        );
      }),
  );
  const releaseGiveawayEndingClaim = mock(async (id: string) => {
    calls.push(`release:${id}`);
    return Ok(undefined);
  });
  const giveawayService = {
    getExpiredGiveaways: mock(async () => Ok(giveaways)),
    claimGiveawayForEnding,
    releaseGiveawayEndingClaim,
    countActiveGiveaways: mock(async () => Ok(0)),
  } as unknown as GiveawayService;

  const drawWinners = mock(
    options.drawWinners ??
      (async () => {
        calls.push("draw");
        return Ok({ winnerIds: ["u1", "u2"], hasInsufficientWinners: false });
      }),
  );
  const sendWinnersMessage = mock(async (_channel: unknown) => {
    calls.push("sendWinners");
    return Ok(undefined);
  });
  const drawService = {
    drawWinners,
    sendWinnersMessage,
  } as unknown as GiveawayDrawService;

  const entryService = {
    getEntryCount: mock(async () => Ok(5)),
  } as unknown as GiveawayEntryService;

  const flush = mock(async () => {
    calls.push("flush");
  });
  const entryCacheService = {
    flush,
    hasUnflushedEntries: mock(options.hasUnflushedEntries ?? (() => false)),
  } as unknown as GiveawayEntryCacheService;

  const endedCounterAdd = mock(() => undefined);
  const metrics = {
    endedGiveawaysCounter: { add: endedCounterAdd },
    activeGiveawaysGauge: { record: mock(() => undefined) },
  } as unknown as GiveawayMetrics;

  const task = new GiveawayTask(
    client,
    deploymentService,
    giveawayService,
    drawService,
    entryService,
    entryCacheService,
    metrics,
  );

  return {
    task,
    calls,
    client,
    channel,
    claimGiveawayForEnding,
    releaseGiveawayEndingClaim,
    drawWinners,
    sendWinnersMessage,
    flush,
    endedCounterAdd,
  };
}

describe("GiveawayTask", () => {
  test("runs on every cluster so each ends giveaways for its own guilds", () => {
    const { task } = setup();
    expect(task.shouldRunOnCluster?.()).toBe(true);
  });

  test("fetches an uncached channel, then claims, draws and announces", async () => {
    const { task, calls, channel, drawWinners, sendWinnersMessage } = setup();

    await task.onTick();

    expect(calls).toEqual([
      "flush",
      "fetchChannel",
      "claim:1",
      "draw",
      "sendWinners",
    ]);

    // Draws from the claimed giveaway, so it isn't marked ended again
    const [drawnGiveaway, allowRepeat, count] = drawWinners.mock
      .calls[0] as unknown as [Giveaway, boolean, number];
    expect(drawnGiveaway.isEnded).toBe(true);
    expect(allowRepeat).toBe(false);
    expect(count).toBe(2);

    expect(sendWinnersMessage.mock.calls[0]?.[0]).toBe(channel);
    const edit = (channel as ReturnType<typeof makeChannel>).messages.edit;
    expect(edit).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["thread", ChannelType.PublicThread],
    ["announcement channel", ChannelType.GuildAnnouncement],
  ])("ends giveaways in a %s", async (_name, type) => {
    const { task, drawWinners, sendWinnersMessage } = setup({
      channel: makeChannel(type),
    });

    await task.onTick();

    expect(drawWinners).toHaveBeenCalledTimes(1);
    expect(sendWinnersMessage).toHaveBeenCalledTimes(1);
  });

  test("only ends giveaways for guilds on this cluster's shards", async () => {
    const { task, claimGiveawayForEnding } = setup({
      giveaways: [
        makeGiveaway("1", { guildId: GUILD_SHARD_0 }),
        makeGiveaway("2", { guildId: GUILD_SHARD_1 }),
      ],
    });

    await task.onTick();

    expect(claimGiveawayForEnding).toHaveBeenCalledTimes(1);
    expect(claimGiveawayForEnding.mock.calls[0]?.[0]).toBe("1");
  });

  test("does not flush or claim when no giveaways are owned", async () => {
    const { task, flush, claimGiveawayForEnding } = setup({
      giveaways: [makeGiveaway("2", { guildId: GUILD_SHARD_1 })],
    });

    await task.onTick();

    expect(flush).not.toHaveBeenCalled();
    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test("waits for entries that couldn't be flushed", async () => {
    const { task, claimGiveawayForEnding } = setup({
      hasUnflushedEntries: () => true,
    });

    await task.onTick();

    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test("does not draw when another process already ended the giveaway", async () => {
    const { task, drawWinners, endedCounterAdd } = setup({
      claim: async () => Ok(null),
    });

    await task.onTick();

    expect(drawWinners).not.toHaveBeenCalled();
    expect(endedCounterAdd).toHaveBeenCalledWith(0);
  });

  test("leaves the giveaway unclaimed on a transient channel fetch error", async () => {
    const { task, claimGiveawayForEnding, drawWinners } = setup({
      fetchChannel: async () => {
        throw discordError(0, 500);
      },
    });

    await task.onTick();

    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
    expect(drawWinners).not.toHaveBeenCalled();
  });

  test.each([
    ["unknown channel", RESTJSONErrorCodes.UnknownChannel, 404],
    ["missing access", RESTJSONErrorCodes.MissingAccess, 403],
  ])(
    "ends without drawing when the channel is gone (%s)",
    async (_name, code, status) => {
      const { task, claimGiveawayForEnding, drawWinners, endedCounterAdd } =
        setup({
          fetchChannel: async () => {
            throw discordError(code, status);
          },
        });

      await task.onTick();

      expect(claimGiveawayForEnding).toHaveBeenCalledTimes(1);
      expect(drawWinners).not.toHaveBeenCalled();
      expect(endedCounterAdd).toHaveBeenCalledWith(1);
    },
  );

  test("ends without drawing when the bot is no longer in the guild", async () => {
    const { task, client, claimGiveawayForEnding, drawWinners } = setup({
      guilds: [],
    });

    await task.onTick();

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(claimGiveawayForEnding).toHaveBeenCalledTimes(1);
    expect(drawWinners).not.toHaveBeenCalled();
  });

  test("retries later when the guild is unavailable", async () => {
    const { task, claimGiveawayForEnding } = setup({
      guilds: [[GUILD_SHARD_0, { available: false }]],
    });

    await task.onTick();

    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test("releases the claim when drawing fails so it is retried", async () => {
    const { task, calls, sendWinnersMessage, endedCounterAdd } = setup({
      drawWinners: async () => Err("Database error"),
    });

    await task.onTick();

    expect(calls).toContain("release:1");
    expect(sendWinnersMessage).not.toHaveBeenCalled();
    expect(endedCounterAdd).toHaveBeenCalledWith(0);
  });

  test("continues with other giveaways after one fails", async () => {
    let first = true;
    const { task, sendWinnersMessage } = setup({
      giveaways: [makeGiveaway("1"), makeGiveaway("2")],
      fetchChannel: async () => {
        if (first) {
          first = false;
          throw new Error("network error");
        }
        return makeChannel();
      },
    });

    await task.onTick();

    expect(sendWinnersMessage).toHaveBeenCalledTimes(1);
  });
});
