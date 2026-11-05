import { describe, expect, mock, test } from "bun:test";
import type { Guild } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { SushiiUpdatesRepository } from "../domain/SushiiUpdatesRepository";
import { BACKFILL_NOTICE } from "../presentation/updatesText";
import { SushiiUpdatesBackfillService } from "./SushiiUpdatesBackfillService";

const CHANNEL = "200000000000000001";

function guild(id: string, canManageWebhooks = true): Guild {
  return {
    id,
    members: { me: {} },
    channels: {
      cache: new Map([
        [CHANNEL, { permissionsFor: () => ({ has: () => canManageWebhooks }) }],
      ]),
    },
  } as unknown as Guild;
}

function setup(guildIds: string[], claimed: string[] = guildIds) {
  const repository = {
    setWebhookId: mock(async () => undefined),
    markDecided: mock(async () => undefined),
    findBackfillCandidates: mock(async () =>
      guildIds.map((guildId) => ({ guildId, channelId: CHANNEL })),
    ),
    claimBackfill: mock(async (guildId: string) =>
      claimed.includes(guildId) ? CHANNEL : null,
    ),
  } satisfies SushiiUpdatesRepository;
  const follow = mock(async () =>
    Ok({ webhookId: "300000000000000001", alreadyFollowing: false }),
  );
  const sourceAvailable = mock(async () => true);
  const notify = mock(async () => true);
  const service = new SushiiUpdatesBackfillService(
    repository,
    { follow, sourceAvailable } as never,
    { notify },
    BACKFILL_NOTICE,
    pino({ level: "silent" }),
    0,
  );
  return { service, repository, follow, sourceAvailable, notify };
}

const allGuilds = (id: string) => guild(id);

describe("SushiiUpdatesBackfillService", () => {
  test("follows claimed guilds in cache and posts one notice each", async () => {
    const t = setup(["1", "2", "3"], ["1", "3"]);
    const cached = new Map([
      ["1", guild("1")],
      ["2", guild("2")],
    ]);

    const result = await t.service.run({
      getGuild: (id) => cached.get(id),
      isActive: () => true,
    });

    expect(result).toEqual({ followed: 1 });
    expect(t.repository.claimBackfill).toHaveBeenCalledTimes(2);
    expect(t.follow).toHaveBeenCalledTimes(1);
    expect(t.follow).toHaveBeenCalledWith(cached.get("1"), CHANNEL, "backfill");
    expect(t.notify).toHaveBeenCalledWith("1", BACKFILL_NOTICE);
  });

  test("claims nothing when the source channel is unavailable", async () => {
    const t = setup(["1", "2"]);
    t.sourceAvailable.mockResolvedValueOnce(false);

    await t.service.run({ getGuild: allGuilds, isActive: () => true });

    expect(t.repository.claimBackfill).not.toHaveBeenCalled();
    expect(t.follow).not.toHaveBeenCalled();
  });

  test("skips guilds where sushii lacks Manage Webhooks without calling Discord", async () => {
    const t = setup(["1"]);

    await t.service.run({
      getGuild: (id) => guild(id, false),
      isActive: () => true,
    });

    expect(t.repository.claimBackfill).toHaveBeenCalledTimes(1);
    expect(t.follow).not.toHaveBeenCalled();
    expect(t.notify).not.toHaveBeenCalled();
  });

  test("stops when the source channel becomes unavailable mid-run", async () => {
    const t = setup(["1", "2"]);
    t.follow.mockResolvedValueOnce(Err("unavailable") as never);
    t.sourceAvailable.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await t.service.run({ getGuild: allGuilds, isActive: () => true });

    expect(t.follow).toHaveBeenCalledTimes(1);
    expect(t.repository.claimBackfill).toHaveBeenCalledTimes(1);
  });

  test("a per-guild error doesn't stop the run while the source is fine", async () => {
    const t = setup(["1", "2", "3"]);
    t.follow
      .mockResolvedValueOnce(Err("channel_access") as never)
      .mockResolvedValueOnce(Err("unavailable") as never);

    const result = await t.service.run({
      getGuild: allGuilds,
      isActive: () => true,
    });

    expect(t.follow).toHaveBeenCalledTimes(3);
    expect(t.sourceAvailable).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ followed: 1 });
  });

  test("skips the notice when the follow fails or already existed", async () => {
    const t = setup(["1", "2"]);
    t.follow
      .mockResolvedValueOnce(Err("missing_permissions") as never)
      .mockResolvedValueOnce(
        Ok({ webhookId: "300000000000000001", alreadyFollowing: true }),
      );

    await t.service.run({ getGuild: allGuilds, isActive: () => true });

    expect(t.follow).toHaveBeenCalledTimes(2);
    expect(t.notify).not.toHaveBeenCalled();
  });

  test("stops when the deployment goes inactive", async () => {
    const t = setup(["1", "2"]);
    let active = true;
    t.notify.mockImplementation(async () => {
      active = false;
      return true;
    });

    await t.service.run({ getGuild: allGuilds, isActive: () => active });

    expect(t.follow).toHaveBeenCalledTimes(1);
  });

  test("one failing guild doesn't stop the rest", async () => {
    const t = setup(["1", "2"]);
    t.follow.mockRejectedValueOnce(new Error("boom"));

    const result = await t.service.run({
      getGuild: allGuilds,
      isActive: () => true,
    });

    expect(result).toEqual({ followed: 1 });
  });
});
