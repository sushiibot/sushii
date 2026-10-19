import { describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type {
  EndGiveawayResult,
  GiveawayEndService,
} from "@/features/giveaways/application/GiveawayEndService";
import type { GiveawayService } from "@/features/giveaways/application/GiveawayService";
import { Giveaway } from "@/features/giveaways/domain/entities/Giveaway";

import type { GiveawayMetrics } from "../metrics/GiveawayMetrics";
import { GiveawayTask } from "./GiveawayTask";

// Guild IDs whose shard (for 2 shards) is 0 and 1 respectively
const GUILD_SHARD_0 = (2n << 22n).toString();
const GUILD_SHARD_1 = (1n << 22n).toString();

function makeGiveaway(id: string, guildId: string = GUILD_SHARD_0): Giveaway {
  return new Giveaway({
    id,
    channelId: "500",
    guildId,
    hostUserId: "400",
    numWinners: 2,
    prize: "Prize",
    startAt: new Date(Date.now() - 120_000),
    endAt: new Date(Date.now() - 1_000),
    isEnded: false,
  });
}

function setup(
  giveaways: Giveaway[],
  endGiveawayImpl: (giveaway: Giveaway) => Promise<EndGiveawayResult> = async (
    giveaway,
  ) => ({
    status: "ended",
    giveaway,
    winnerIds: ["u1"],
    hasInsufficientWinners: false,
  }),
) {
  const client = {
    options: { shardCount: 2 },
    cluster: { shardList: [0] },
  } as unknown as Client;

  const deploymentService = {
    isCurrentDeploymentActive: () => true,
  } as unknown as DeploymentService;

  const giveawayService = {
    getExpiredGiveaways: mock(async () => giveaways),
    countActiveGiveaways: mock(async () => 0),
  } as unknown as GiveawayService;

  const endGiveaway = mock(endGiveawayImpl);
  const endService = { endGiveaway } as unknown as GiveawayEndService;

  const endedCounterAdd = mock(() => undefined);
  const metrics = {
    endedGiveawaysCounter: { add: endedCounterAdd },
    activeGiveawaysGauge: { record: mock(() => undefined) },
  } as unknown as GiveawayMetrics;

  const task = new GiveawayTask(
    client,
    deploymentService,
    giveawayService,
    endService,
    metrics,
  );

  return { task, endGiveaway, endedCounterAdd };
}

describe("GiveawayTask", () => {
  test("runs on every cluster so each ends giveaways for its own guilds", () => {
    const { task } = setup([]);
    expect(task.shouldRunOnCluster?.()).toBe(true);
  });

  test("only ends giveaways for guilds on this cluster's shards", async () => {
    const { task, endGiveaway } = setup([
      makeGiveaway("1", GUILD_SHARD_0),
      makeGiveaway("2", GUILD_SHARD_1),
    ]);

    await task.onTick();

    expect(endGiveaway).toHaveBeenCalledTimes(1);
    const [giveaway, options] = endGiveaway.mock.calls[0] as unknown as [
      Giveaway,
      { endIfChannelUnavailable: boolean },
    ];
    expect(giveaway.id).toBe("1");
    // Expired giveaways in deleted channels must not be retried forever
    expect(options.endIfChannelUnavailable).toBe(true);
  });

  test("counts only giveaways this run ended", async () => {
    const results: EndGiveawayResult[] = [
      { status: "alreadyEnded" },
      { status: "endedWithoutDraw", reason: "channel not found" },
      { status: "retry", reason: "guild unavailable" },
    ];
    const { task, endedCounterAdd } = setup(
      [makeGiveaway("1"), makeGiveaway("2"), makeGiveaway("3")],
      async () => results.shift() as EndGiveawayResult,
    );

    await task.onTick();

    expect(endedCounterAdd).toHaveBeenCalledWith(1);
  });

  test("continues with other giveaways after one fails", async () => {
    let first = true;
    const { task, endGiveaway, endedCounterAdd } = setup(
      [makeGiveaway("1"), makeGiveaway("2")],
      async (giveaway) => {
        if (first) {
          first = false;
          throw new Error("network error");
        }
        return {
          status: "ended",
          giveaway,
          winnerIds: [],
          hasInsufficientWinners: true,
        };
      },
    );

    await task.onTick();

    expect(endGiveaway).toHaveBeenCalledTimes(2);
    expect(endedCounterAdd).toHaveBeenCalledWith(1);
  });
});
