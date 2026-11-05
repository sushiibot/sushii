import { describe, expect, mock, test } from "bun:test";
import type { Guild } from "discord.js";
import { DiscordAPIError, Routes, WebhookType } from "discord.js";
import pino from "pino";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { SushiiUpdatesRepository } from "../domain/SushiiUpdatesRepository";
import type { SushiiUpdatesMetrics } from "../infrastructure/SushiiUpdatesMetrics";
import type { UpdatesRest } from "./SushiiUpdatesService";
import { SushiiUpdatesService } from "./SushiiUpdatesService";
import type { SushiiUpdatesSettingsInput } from "./SushiiUpdatesSettingsPort";
import {
  sushiiUpdatesSyncNeeded,
  updatesCheckboxDefault,
} from "./SushiiUpdatesSettingsPort";

const GUILD_ID = "100000000000000001";
const SOURCE_ID = "828010062383153192";
const CHANNEL_ID = "200000000000000001";
const OTHER_CHANNEL_ID = "200000000000000002";
const WEBHOOK_ID = "300000000000000001";
const NEW_WEBHOOK_ID = "300000000000000002";

function discordError(code: number, status = 403): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "error" },
    code,
    status,
    "POST",
    "/test",
    {},
  );
}

function follower(id: string, channelId = CHANNEL_ID) {
  return {
    id,
    type: WebhookType.ChannelFollower,
    channel_id: channelId,
    source_channel: { id: SOURCE_ID },
  };
}

const guild = { id: GUILD_ID } as unknown as Guild;

function setup(opts: { webhookId?: string | null; optedOut?: boolean } = {}) {
  // Stateful so a second follow sees what the first one stored.
  const state = { webhookId: opts.webhookId ?? null };
  const channelWebhooks = new Map<string, unknown[]>();
  if (state.webhookId) {
    channelWebhooks.set(CHANNEL_ID, [follower(state.webhookId)]);
  }

  const rest = {
    get: mock(async (route: string): Promise<unknown> => {
      for (const [channelId, hooks] of channelWebhooks) {
        if (route === Routes.channelWebhooks(channelId)) {
          return hooks;
        }
      }
      return [];
    }),
    post: mock(
      async (
        _route: string,
        opts: { body: { webhook_channel_id: string } },
      ): Promise<unknown> => {
        // Lets a concurrent call run while this one is "on the network".
        await Promise.resolve();
        const target = opts.body.webhook_channel_id;
        channelWebhooks.set(target, [
          ...(channelWebhooks.get(target) ?? []),
          follower(NEW_WEBHOOK_ID, target),
        ]);
        return { channel_id: SOURCE_ID, webhook_id: NEW_WEBHOOK_ID };
      },
    ),
    delete: mock(async (): Promise<unknown> => undefined),
  };
  const repository = {
    setWebhookId: mock(async (_guildId: string, id: string | null) => {
      state.webhookId = id;
    }),
    markDecided: mock(async () => undefined),
    findBackfillCandidates: mock(async () => []),
    claimBackfill: mock(async () => null),
  } satisfies SushiiUpdatesRepository;
  const guildConfigRepository = {
    findByGuildId: mock(async () => {
      const config = GuildConfig.createDefault(GUILD_ID);
      config.loggingSettings.sushiiUpdatesWebhookId = state.webhookId;
      return config;
    }),
    save: mock(async (c: GuildConfig) => c),
  } satisfies GuildConfigRepository;
  const recordFollow = mock(() => undefined);
  const recordUnfollow = mock(() => undefined);
  const optOut = {
    record: mock(async () => undefined),
    isOptedOut: mock(async () => opts.optedOut ?? false),
  };

  const service = new SushiiUpdatesService(
    rest as unknown as UpdatesRest,
    SOURCE_ID,
    repository,
    guildConfigRepository,
    { recordFollow, recordUnfollow } as unknown as SushiiUpdatesMetrics,
    optOut,
    pino({ level: "silent" }),
  );

  return {
    service,
    rest,
    repository,
    recordFollow,
    recordUnfollow,
    optOut,
    state,
    channelWebhooks,
  };
}

describe("SushiiUpdatesService.follow", () => {
  test("creates a follower webhook and stores its ID", async () => {
    const t = setup();

    const result = await t.service.follow(guild, CHANNEL_ID, "settings");

    expect(result.val).toEqual({
      webhookId: NEW_WEBHOOK_ID,
      alreadyFollowing: false,
    });
    expect(t.rest.get).toHaveBeenCalledWith(Routes.channelWebhooks(CHANNEL_ID));
    expect(t.rest.post).toHaveBeenCalledWith(
      Routes.channelFollowers(SOURCE_ID),
      { body: { webhook_channel_id: CHANNEL_ID } },
    );
    expect(t.state.webhookId).toBe(NEW_WEBHOOK_ID);
    expect(t.repository.markDecided).toHaveBeenCalledWith(GUILD_ID);
    expect(t.recordFollow).toHaveBeenCalledWith("settings", "followed");
  });

  test("reuses a follow the server already set up in that channel", async () => {
    const t = setup();
    t.channelWebhooks.set(CHANNEL_ID, [
      { id: "300000000000000008", type: WebhookType.Incoming },
      follower(WEBHOOK_ID),
    ]);

    const result = await t.service.follow(guild, CHANNEL_ID, "prompt");

    expect(result.val).toEqual({
      webhookId: WEBHOOK_ID,
      alreadyFollowing: true,
    });
    expect(t.rest.post).not.toHaveBeenCalled();
    expect(t.state.webhookId).toBe(WEBHOOK_ID);
    expect(t.recordFollow).toHaveBeenCalledWith("prompt", "already_following");
  });

  test("a stale prompt after following elsewhere doesn't add a second follower", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const result = await t.service.follow(guild, CHANNEL_ID, "prompt");

    expect(result.val).toEqual({
      webhookId: WEBHOOK_ID,
      alreadyFollowing: true,
    });
    expect(t.rest.post).not.toHaveBeenCalled();
    expect(t.rest.delete).not.toHaveBeenCalled();
  });

  test("a double click creates one follower", async () => {
    const t = setup();

    const [first, second] = await Promise.all([
      t.service.follow(guild, CHANNEL_ID, "prompt"),
      t.service.follow(guild, CHANNEL_ID, "prompt"),
    ]);

    expect(first.ok && second.ok).toBe(true);
    expect(t.rest.post).toHaveBeenCalledTimes(1);
    expect(t.rest.delete).not.toHaveBeenCalled();
  });

  test("moving to another channel removes the old follower first", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const result = await t.service.follow(guild, OTHER_CHANNEL_ID, "prompt");

    expect(result.val).toEqual({
      webhookId: NEW_WEBHOOK_ID,
      alreadyFollowing: false,
    });
    expect(t.rest.delete).toHaveBeenCalledWith(Routes.webhook(WEBHOOK_ID));
    expect(t.rest.post).toHaveBeenCalledTimes(1);
  });

  test("doesn't follow again when the old follower can't be removed", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });
    t.rest.delete.mockRejectedValueOnce(discordError(50013));

    const result = await t.service.follow(guild, OTHER_CHANNEL_ID, "prompt");

    expect(result.val).toBe("previous_follow");
    expect(t.rest.post).not.toHaveBeenCalled();
    expect(t.state.webhookId).toBe(WEBHOOK_ID);
  });

  test("a move into a channel at the webhook limit keeps the old follow", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });
    t.channelWebhooks.set(
      OTHER_CHANNEL_ID,
      Array.from({ length: 15 }, (_, i) => ({
        id: `30000000000000000${i.toString().padStart(2, "0")}`,
        type: WebhookType.Incoming,
        channel_id: OTHER_CHANNEL_ID,
      })),
    );

    const result = await t.service.follow(guild, OTHER_CHANNEL_ID, "prompt");

    expect(result.val).toBe("webhook_limit");
    expect(t.rest.delete).not.toHaveBeenCalled();
    expect(t.rest.post).not.toHaveBeenCalled();
    expect(t.state.webhookId).toBe(WEBHOOK_ID);
  });

  test("losing access to the old channel is reported, not thrown", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });
    t.rest.delete.mockRejectedValueOnce(discordError(50001));

    const result = await t.service.follow(guild, OTHER_CHANNEL_ID, "prompt");

    expect(result.val).toBe("previous_follow");
    expect(t.rest.post).not.toHaveBeenCalled();
  });

  test("backfill doesn't mark the guild decided; its claim already did", async () => {
    const t = setup();

    await t.service.follow(guild, CHANNEL_ID, "backfill");

    expect(t.repository.markDecided).not.toHaveBeenCalled();
  });

  test.each([
    [50013, "missing_permissions"],
    [50001, "channel_access"],
    [10003, "channel_access"],
  ] as const)(
    "listing the target channel's webhooks: %d → %s",
    async (code, expected) => {
      const t = setup();
      t.rest.get.mockRejectedValueOnce(discordError(code));

      const result = await t.service.follow(guild, CHANNEL_ID, "settings");

      expect(result.val).toBe(expected);
      expect(t.rest.post).not.toHaveBeenCalled();
      expect(t.recordFollow).toHaveBeenCalledWith("settings", expected);
    },
  );

  test.each([
    [50013, "missing_permissions"],
    [30007, "webhook_limit"],
    [10003, "unavailable"],
    [50001, "unavailable"],
  ] as const)("creating the follower: %d → %s", async (code, expected) => {
    const t = setup();
    t.rest.post.mockRejectedValueOnce(discordError(code));

    const result = await t.service.follow(guild, CHANNEL_ID, "settings");

    expect(result.err).toBe(true);
    expect(result.val).toBe(expected);
    expect(t.repository.setWebhookId).not.toHaveBeenCalled();
  });

  test("throws on unexpected errors", async () => {
    const t = setup();
    t.rest.post.mockRejectedValueOnce(new Error("socket hang up"));

    expect(t.service.follow(guild, CHANNEL_ID, "settings")).rejects.toThrow(
      "Failed to follow sushii updates",
    );
  });
});

describe("SushiiUpdatesService.unfollow", () => {
  test("deletes the stored webhook and clears it", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const result = await t.service.unfollow(guild, "settings");

    expect(result.val).toBe(true);
    expect(t.rest.delete).toHaveBeenCalledWith(Routes.webhook(WEBHOOK_ID));
    expect(t.state.webhookId).toBeNull();
    expect(t.recordUnfollow).toHaveBeenCalledWith("settings");
  });

  test("a webhook deleted by hand counts as unfollowed", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });
    t.rest.delete.mockRejectedValueOnce(discordError(10015, 404));

    const result = await t.service.unfollow(guild, "settings");

    expect(result.val).toBe(true);
    expect(t.state.webhookId).toBeNull();
  });

  test("keeps the ID when sushii can't delete the webhook", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });
    t.rest.delete.mockRejectedValueOnce(discordError(50013));

    const result = await t.service.unfollow(guild, "settings");

    expect(result.val).toBe("missing_permissions");
    expect(t.state.webhookId).toBe(WEBHOOK_ID);
  });

  test("does nothing when not following", async () => {
    const t = setup();

    const result = await t.service.unfollow(guild, "settings");

    expect(result.val).toBe(false);
    expect(t.rest.delete).not.toHaveBeenCalled();
    expect(t.recordUnfollow).not.toHaveBeenCalled();
  });
});

describe("SushiiUpdatesService.applySettings", () => {
  const input = (
    overrides: Partial<SushiiUpdatesSettingsInput>,
  ): SushiiUpdatesSettingsInput => ({
    channelId: CHANNEL_ID,
    follow: true,
    previousChannelId: CHANNEL_ID,
    wasFollowing: true,
    shownChecked: true,
    ...overrides,
  });

  test("moving the channel unfollows the old one and follows the new one", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const outcome = await t.service.applySettings(
      guild,
      input({ channelId: OTHER_CHANNEL_ID }),
    );

    expect(outcome).toEqual({ kind: "followed", channelId: OTHER_CHANNEL_ID });
    expect(t.rest.delete).toHaveBeenCalledWith(Routes.webhook(WEBHOOK_ID));
    expect(t.rest.post).toHaveBeenCalledWith(
      Routes.channelFollowers(SOURCE_ID),
      { body: { webhook_channel_id: OTHER_CHANNEL_ID } },
    );
    expect(t.optOut.record).not.toHaveBeenCalled();
  });

  test("unticking a ticked box unfollows and records the opt-out", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const outcome = await t.service.applySettings(
      guild,
      input({ follow: false }),
    );

    expect(outcome).toEqual({ kind: "unfollowed" });
    expect(t.optOut.record).toHaveBeenCalledWith(GUILD_ID);
    expect(t.repository.markDecided).toHaveBeenCalledWith(GUILD_ID);
  });

  test("leaving an unticked box unticked doesn't record a new opt-out", async () => {
    const t = setup();

    const outcome = await t.service.applySettings(
      guild,
      input({
        channelId: OTHER_CHANNEL_ID,
        follow: false,
        wasFollowing: false,
        shownChecked: false,
      }),
    );

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(t.optOut.record).not.toHaveBeenCalled();
    expect(t.repository.markDecided).not.toHaveBeenCalled();
  });

  test("an undecided guild changing channel with the default box follows", async () => {
    const t = setup();

    const outcome = await t.service.applySettings(
      guild,
      input({
        channelId: OTHER_CHANNEL_ID,
        wasFollowing: false,
        shownChecked: true,
      }),
    );

    expect(outcome).toEqual({ kind: "followed", channelId: OTHER_CHANNEL_ID });
    expect(t.optOut.record).not.toHaveBeenCalled();
  });

  test("an unchanged follow only re-checks the channel's webhooks", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const outcome = await t.service.applySettings(guild, input({}));

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(t.rest.get).toHaveBeenCalledWith(Routes.channelWebhooks(CHANNEL_ID));
    expect(t.rest.post).not.toHaveBeenCalled();
    expect(t.rest.delete).not.toHaveBeenCalled();
  });

  test("uses the stored webhook, not the panel's stale view", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });

    const outcome = await t.service.applySettings(
      guild,
      input({ channelId: null, wasFollowing: false }),
    );

    expect(outcome).toEqual({ kind: "unfollowed" });
    expect(t.rest.delete).toHaveBeenCalledWith(Routes.webhook(WEBHOOK_ID));
  });

  test("a panel that thought it followed doesn't delete anything already gone", async () => {
    const t = setup();

    const outcome = await t.service.applySettings(
      guild,
      input({ channelId: null }),
    );

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(t.rest.delete).not.toHaveBeenCalled();
  });

  test("reports a failed follow while keeping the channel", async () => {
    const t = setup();
    t.rest.post.mockRejectedValueOnce(discordError(50013));

    const outcome = await t.service.applySettings(
      guild,
      input({ previousChannelId: null, wasFollowing: false }),
    );

    expect(outcome).toEqual({
      kind: "follow_failed",
      channelId: CHANNEL_ID,
      error: "missing_permissions",
    });
  });

  test("reports an unfollow sushii isn't allowed to do", async () => {
    const t = setup({ webhookId: WEBHOOK_ID });
    t.rest.delete.mockRejectedValueOnce(discordError(50013));

    const outcome = await t.service.applySettings(
      guild,
      input({ follow: false }),
    );

    expect(outcome).toEqual({
      kind: "unfollow_failed",
      channelId: CHANNEL_ID,
      error: "missing_permissions",
    });
  });
});

describe("SushiiUpdatesService.getForSettings", () => {
  const channelGuild = (perms: boolean) =>
    ({
      id: GUILD_ID,
      members: { me: {} },
      channels: {
        cache: new Map([
          [CHANNEL_ID, { permissionsFor: () => ({ has: () => perms }) }],
        ]),
      },
    }) as unknown as Guild;

  test("reports opt-out and webhook permissions", async () => {
    const t = setup({ optedOut: true });
    const config = GuildConfig.createDefault(GUILD_ID).updateLogChannel(
      "notifications",
      CHANNEL_ID,
    );

    expect(await t.service.getForSettings(channelGuild(false), config)).toEqual(
      { following: false, optedOut: true, canManageWebhooks: false },
    );
  });

  test("a following guild isn't opted out", async () => {
    const t = setup({ optedOut: true });
    const config = GuildConfig.createDefault(GUILD_ID).updateLogChannel(
      "notifications",
      CHANNEL_ID,
    );
    config.loggingSettings.sushiiUpdatesWebhookId = WEBHOOK_ID;

    expect(await t.service.getForSettings(channelGuild(true), config)).toEqual({
      following: true,
      optedOut: false,
      canManageWebhooks: true,
    });
    expect(t.optOut.isOptedOut).not.toHaveBeenCalled();
  });
});

describe("SushiiUpdatesService.sourceAvailable", () => {
  test("true for an announcement channel", async () => {
    const t = setup();
    t.rest.get.mockResolvedValueOnce({ id: SOURCE_ID, type: 5 });

    expect(await t.service.sourceAvailable()).toBe(true);
    expect(t.rest.get).toHaveBeenCalledWith(Routes.channel(SOURCE_ID));
  });

  test("false for a plain text channel", async () => {
    const t = setup();
    t.rest.get.mockResolvedValueOnce({ id: SOURCE_ID, type: 0 });

    expect(await t.service.sourceAvailable()).toBe(false);
  });

  test("false when Discord rejects the lookup", async () => {
    const t = setup();
    t.rest.get.mockRejectedValueOnce(discordError(50001));

    expect(await t.service.sourceAvailable()).toBe(false);
  });
});

describe("updatesCheckboxDefault", () => {
  test.each([
    [{ following: true, optedOut: true }, true],
    [{ following: false, optedOut: false }, true],
    [{ following: false, optedOut: true }, false],
  ])("%o → %p", (state, expected) => {
    expect(updatesCheckboxDefault({ ...state, canManageWebhooks: true })).toBe(
      expected,
    );
  });
});

describe("sushiiUpdatesSyncNeeded", () => {
  const base = {
    channelId: CHANNEL_ID,
    previousChannelId: CHANNEL_ID,
    shownChecked: true,
  };

  test.each([
    [{ ...base, follow: true, wasFollowing: true }, true],
    [{ ...base, follow: true, wasFollowing: false }, true],
    [{ ...base, follow: false, wasFollowing: true }, true],
    [{ ...base, follow: false, wasFollowing: false }, false],
    [{ ...base, channelId: null, follow: true, wasFollowing: false }, false],
    [{ ...base, channelId: null, follow: true, wasFollowing: true }, true],
    [
      {
        ...base,
        channelId: OTHER_CHANNEL_ID,
        follow: true,
        wasFollowing: true,
      },
      true,
    ],
  ])("%o → %p", (input, expected) => {
    expect(sushiiUpdatesSyncNeeded(input)).toBe(expected);
  });
});
