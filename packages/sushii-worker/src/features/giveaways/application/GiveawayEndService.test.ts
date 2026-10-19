import { describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { ChannelType, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";
import type { Result } from "ts-results";

import { Giveaway } from "../domain/entities/Giveaway";
import type { DrawResult, GiveawayDrawService } from "./GiveawayDrawService";
import type { EndGiveawayOptions } from "./GiveawayEndService";
import { GiveawayEndService } from "./GiveawayEndService";
import type { GiveawayEntryCacheService } from "./GiveawayEntryCacheService";
import type { GiveawayEntryService } from "./GiveawayEntryService";
import type { GiveawayService } from "./GiveawayService";

const GUILD_ID = "100";
const CHANNEL_ID = "500";

function makeGiveaway(id = "1", numWinners = 3): Giveaway {
  return new Giveaway({
    id,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    hostUserId: "400",
    numWinners,
    prize: "Prize",
    startAt: new Date(Date.now() - 120_000),
    endAt: new Date(Date.now() - 1_000),
    isEnded: false,
  });
}

function makeChannel(type: ChannelType = ChannelType.GuildText) {
  return {
    id: CHANNEL_ID,
    guildId: GUILD_ID,
    type,
    isTextBased: () => true,
    isDMBased: () => false,
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
  channel?: unknown;
  fetchChannel?: (id: string) => Promise<unknown>;
  guilds?: [string, { available: boolean }][];
  claim?: (id: string) => Promise<Result<Giveaway | null, string>>;
  drawWinners?: () => Promise<Result<DrawResult, string>>;
  hasUnflushedEntries?: (id: string) => boolean;
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = [];
  const channel = options.channel ?? makeChannel();

  const client = {
    guilds: {
      cache: new Map(options.guilds ?? [[GUILD_ID, { available: true }]]),
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

  const claimGiveawayForEnding = mock(
    options.claim ??
      (async (id: string) => {
        calls.push(`claim:${id}`);
        return Ok(
          Giveaway.fromData({ ...makeGiveaway(id).toData(), isEnded: true }),
        );
      }),
  );
  const releaseGiveawayEndingClaim = mock(async (id: string) => {
    calls.push(`release:${id}`);
    return Ok(undefined);
  });
  const giveawayService = {
    claimGiveawayForEnding,
    releaseGiveawayEndingClaim,
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

  const updateEndedMessage = mock(
    async (
      _channel: unknown,
      _giveaway: Giveaway,
      _winnerIds: string[],
      _entryCount: number,
    ) => {
      calls.push("updateMessage");
    },
  );

  const service = new GiveawayEndService(
    client,
    giveawayService,
    drawService,
    entryService,
    entryCacheService,
    updateEndedMessage,
    pino({ level: "silent" }),
  );

  return {
    service,
    calls,
    client,
    channel,
    claimGiveawayForEnding,
    releaseGiveawayEndingClaim,
    drawWinners,
    sendWinnersMessage,
    flush,
    updateEndedMessage,
  };
}

const END_IF_UNAVAILABLE: EndGiveawayOptions = {
  endIfChannelUnavailable: true,
};
const KEEP_IF_UNAVAILABLE: EndGiveawayOptions = {
  endIfChannelUnavailable: false,
};

describe("GiveawayEndService", () => {
  test("flushes, claims, draws all winners, announces and updates the message", async () => {
    const { service, calls, channel, drawWinners, updateEndedMessage } =
      setup();

    const result = await service.endGiveaway(
      makeGiveaway("1", 3),
      END_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("ended");
    expect(calls).toEqual([
      "flush",
      "fetchChannel",
      "claim:1",
      "draw",
      "sendWinners",
      "updateMessage",
    ]);

    // Draws from the claimed giveaway, so it isn't marked ended again
    const [drawnGiveaway, allowRepeat, count] = drawWinners.mock
      .calls[0] as unknown as [Giveaway, boolean, number];
    expect(drawnGiveaway.isEnded).toBe(true);
    expect(allowRepeat).toBe(false);
    expect(count).toBe(3);

    const [updatedChannel, updatedGiveaway, winnerIds, entryCount] =
      updateEndedMessage.mock.calls[0];
    expect(updatedChannel).toBe(channel);
    expect(updatedGiveaway.isEnded).toBe(true);
    expect(winnerIds).toEqual(["u1", "u2"]);
    expect(entryCount).toBe(5);
  });

  test.each([
    ["thread", ChannelType.PublicThread],
    ["announcement channel", ChannelType.GuildAnnouncement],
  ])("ends giveaways in a %s", async (_name, type) => {
    const { service, drawWinners, sendWinnersMessage } = setup({
      channel: makeChannel(type),
    });

    await service.endGiveaway(makeGiveaway(), END_IF_UNAVAILABLE);

    expect(drawWinners).toHaveBeenCalledTimes(1);
    expect(sendWinnersMessage).toHaveBeenCalledTimes(1);
  });

  test("waits for entries that couldn't be flushed", async () => {
    const { service, claimGiveawayForEnding } = setup({
      hasUnflushedEntries: () => true,
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("retry");
    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test("does not draw when the giveaway was already ended elsewhere", async () => {
    const { service, drawWinners, updateEndedMessage } = setup({
      claim: async () => Ok(null),
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("alreadyEnded");
    expect(drawWinners).not.toHaveBeenCalled();
    expect(updateEndedMessage).not.toHaveBeenCalled();
  });

  test("throws when claiming fails", async () => {
    const { service, drawWinners } = setup({
      claim: async () => Err("Database error"),
    });

    await expect(
      service.endGiveaway(makeGiveaway(), END_IF_UNAVAILABLE),
    ).rejects.toThrow("Failed to claim giveaway for ending");
    expect(drawWinners).not.toHaveBeenCalled();
  });

  test("throws without claiming on a transient channel fetch error", async () => {
    const { service, claimGiveawayForEnding } = setup({
      fetchChannel: async () => {
        throw discordError(0, 500);
      },
    });

    await expect(
      service.endGiveaway(makeGiveaway(), END_IF_UNAVAILABLE),
    ).rejects.toThrow("Failed to fetch giveaway channel");
    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test.each([
    ["unknown channel", RESTJSONErrorCodes.UnknownChannel, 404],
    ["missing access", RESTJSONErrorCodes.MissingAccess, 403],
  ])(
    "ends without drawing when the channel is gone (%s)",
    async (_name, code, status) => {
      const { service, claimGiveawayForEnding, drawWinners } = setup({
        fetchChannel: async () => {
          throw discordError(code, status);
        },
      });

      const result = await service.endGiveaway(
        makeGiveaway(),
        END_IF_UNAVAILABLE,
      );

      expect(result.status).toBe("endedWithoutDraw");
      expect(claimGiveawayForEnding).toHaveBeenCalledTimes(1);
      expect(drawWinners).not.toHaveBeenCalled();
    },
  );

  test("leaves the giveaway active when the channel is gone if asked to", async () => {
    const { service, claimGiveawayForEnding } = setup({
      fetchChannel: async () => {
        throw discordError(RESTJSONErrorCodes.MissingAccess, 403);
      },
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      KEEP_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("channelUnavailable");
    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test("ends without drawing when the bot is no longer in the guild", async () => {
    const { service, client, claimGiveawayForEnding, drawWinners } = setup({
      guilds: [],
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("endedWithoutDraw");
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(claimGiveawayForEnding).toHaveBeenCalledTimes(1);
    expect(drawWinners).not.toHaveBeenCalled();
  });

  test("retries later when the guild is unavailable", async () => {
    const { service, claimGiveawayForEnding } = setup({
      guilds: [[GUILD_ID, { available: false }]],
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("retry");
    expect(claimGiveawayForEnding).not.toHaveBeenCalled();
  });

  test("releases the claim when drawing fails so it can be retried", async () => {
    const { service, calls, sendWinnersMessage, updateEndedMessage } = setup({
      drawWinners: async () => Err("Database error"),
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result).toEqual({ status: "drawFailed", error: "Database error" });
    expect(calls).toContain("release:1");
    expect(sendWinnersMessage).not.toHaveBeenCalled();
    expect(updateEndedMessage).not.toHaveBeenCalled();
  });

  test("still updates the message when there are no entries", async () => {
    const { service, sendWinnersMessage, updateEndedMessage } = setup({
      drawWinners: async () =>
        Ok({
          winnerIds: [],
          hasInsufficientWinners: true,
          reason: "No eligible entries found",
        }),
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result).toMatchObject({
      status: "ended",
      winnerIds: [],
      hasInsufficientWinners: true,
    });
    expect(sendWinnersMessage).not.toHaveBeenCalled();
    expect(updateEndedMessage).toHaveBeenCalledTimes(1);
  });

  test("still reports the giveaway ended when the message update fails", async () => {
    const { service, updateEndedMessage } = setup();
    updateEndedMessage.mockImplementation(async () => {
      throw new Error("Unknown Message");
    });

    const result = await service.endGiveaway(
      makeGiveaway(),
      END_IF_UNAVAILABLE,
    );

    expect(result.status).toBe("ended");
  });
});
