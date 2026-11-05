import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Guild } from "discord.js";
import {
  DiscordAPIError,
  HTTPError,
  MessageReferenceType,
  RESTJSONErrorCodes,
} from "discord.js";
import pino from "pino";

import type {
  ClaimResult,
  DeliveryResult,
  SushiiUpdatesRepository,
} from "../domain/SushiiUpdatesRepository";
import type { RelayTarget, UpdatePost } from "../domain/UpdatePost";
import type { SushiiUpdatesMetrics } from "../infrastructure/SushiiUpdatesMetrics";
import { SushiiUpdatesRelayService } from "./SushiiUpdatesRelayService";

const SOURCE_CHANNEL = "300000000000000001";
const SOURCE_GUILD = "310000000000000001";
const POST_A = "900000000000000001";
const POST_B = "900000000000000002";
const CHANNEL = "200000000000000001";

function apiError(code: number, status = 403): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "error" },
    code,
    status,
    "POST",
    "/channels",
    {},
  );
}

function post(messageId: string): UpdatePost {
  return { messageId, createdAt: new Date() };
}

function makeGuild(
  id: string,
  opts: { canSend?: boolean; available?: boolean } = {},
) {
  return {
    id,
    available: opts.available ?? true,
    members: { me: {} },
    channels: {
      cache: new Map([
        [
          CHANNEL,
          {
            isSendable: () => true,
            permissionsFor: () => ({ has: () => opts.canSend ?? true }),
          },
        ],
      ]),
    },
  } as unknown as Guild;
}

interface SetupOptions {
  posts?: UpdatePost[];
  /** Pending guild IDs per post; defaults to every passed guild ID. */
  targets?: (postId: string, guildIds: string[]) => string[];
  claim?: (postId: string, guildId: string) => ClaimResult;
  send?: (channel: string, body: unknown) => Promise<unknown>;
  sourceMessage?: () => Promise<unknown>;
  /** Every guild already got its intro. */
  introDone?: boolean;
}

function setup(opts: SetupOptions = {}) {
  const completed: [string, string, DeliveryResult][] = [];
  const introduced = new Set<string>();
  const repository = {
    savePost: mock(async () => true),
    deletePost: mock(async () => undefined),
    deletePostsBefore: mock(async () => 0),
    findPostsSince: mock(async (_since: Date) => opts.posts ?? [post(POST_A)]),
    findPendingTargets: mock(
      async (postId: string, guildIds: string[]): Promise<RelayTarget[]> =>
        (opts.targets ? opts.targets(postId, guildIds) : guildIds).map(
          (guildId) => ({ guildId, channelId: CHANNEL }),
        ),
    ),
    claimDelivery: mock(
      async (postId: string, guildId: string): Promise<ClaimResult> =>
        opts.claim
          ? opts.claim(postId, guildId)
          : { kind: "claimed", attempt: 1 },
    ),
    releaseClaim: mock(async () => undefined),
    completeDelivery: mock(
      async (postId: string, guildId: string, result: DeliveryResult) => {
        completed.push([postId, guildId, result]);
      },
    ),
    claimIntro: mock(async (guildId: string) => {
      if (opts.introDone || introduced.has(guildId)) {
        return false;
      }
      introduced.add(guildId);
      return true;
    }),
    countStuckClaims: mock(async () => 0),
  } satisfies SushiiUpdatesRepository;

  const get = mock(async (route: string): Promise<unknown> => {
    if (route === `/channels/${SOURCE_CHANNEL}`) {
      return { id: SOURCE_CHANNEL, guild_id: SOURCE_GUILD };
    }
    return opts.sourceMessage ? opts.sourceMessage() : { id: POST_A };
  });
  let messageId = 700000000000000000n;
  const post_ = mock(
    async (route: string, init: { body: unknown }): Promise<unknown> => {
      const channel = route.split("/")[2];
      if (opts.send) {
        return opts.send(channel, init.body);
      }
      messageId += 1n;
      return { id: messageId.toString() };
    },
  );
  const sleep = mock(async (_ms: number) => undefined);
  const recordRelay = mock(() => undefined);
  const logger = pino({ level: "silent" });
  const warn = spyOn(logger, "warn");
  const clock = { now: new Date("2026-11-05T12:00:00Z") };
  const service = new SushiiUpdatesRelayService(
    { get, post: post_ } as never,
    SOURCE_CHANNEL,
    repository,
    {
      recordRelay,
      recordStuckClaims: mock(() => undefined),
    } as unknown as SushiiUpdatesMetrics,
    { mention: () => "</settings:1>" },
    logger,
    { sendDelayMs: 100, sleep, now: () => clock.now },
  );
  return {
    service,
    repository,
    get,
    post: post_,
    sleep,
    completed,
    recordRelay,
    warn,
    clock,
  };
}

function run(
  service: SushiiUpdatesRelayService,
  guilds: Guild[],
  isActive: () => boolean = () => true,
) {
  const byId = new Map(guilds.map((g) => [g.id, g]));
  return service.run({
    guildIds: () => [...byId.keys()],
    getGuild: (id) => byId.get(id),
    isActive,
  });
}

const isForward = (body: unknown) =>
  typeof body === "object" && body !== null && "message_reference" in body;

describe("SushiiUpdatesRelayService", () => {
  test("forwards with only a message reference to the source post", async () => {
    const t = setup({ introDone: true });

    await run(t.service, [makeGuild("1")]);

    expect(t.repository.findPendingTargets).toHaveBeenCalledWith(POST_A, ["1"]);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]).toEqual([
      `/channels/${CHANNEL}/messages`,
      {
        body: {
          message_reference: {
            type: MessageReferenceType.Forward,
            message_id: POST_A,
            channel_id: SOURCE_CHANNEL,
            guild_id: SOURCE_GUILD,
          },
        },
      },
    ]);
    expect(t.completed).toEqual([
      [POST_A, "1", { status: "sent", messageId: "700000000000000001" }],
    ]);
    expect(t.recordRelay).toHaveBeenCalledWith("sent");
  });

  test("a server's first forward gets the intro footer once", async () => {
    const t = setup({ posts: [post(POST_A), post(POST_B)] });

    await run(t.service, [makeGuild("1")]);

    const bodies = t.post.mock.calls.map((c) => c[1].body);
    expect(bodies.map(isForward)).toEqual([true, false, true]);
    expect(JSON.stringify(bodies[1])).toContain(
      "This is a sushii update from the support server. Turn it off in </settings:1> → Logging → sushii notifications.",
    );
    expect(bodies[1]).toMatchObject({ allowed_mentions: { parse: [] } });
  });

  test("a failed footer is ignored", async () => {
    const t = setup({
      send: async (_channel, body) => {
        if (!isForward(body)) {
          throw apiError(RESTJSONErrorCodes.MissingPermissions);
        }
        return { id: "700000000000000001" };
      },
    });

    await run(t.service, [makeGuild("1")]);

    expect(t.completed[0][2].status).toBe("sent");
  });

  test("paces after failed sends too, but not after skips or lost claims", async () => {
    const t = setup({
      introDone: true,
      claim: (_p, guildId) =>
        guildId === "4" ? { kind: "taken" } : { kind: "claimed", attempt: 1 },
      send: async (channel) => {
        void channel;
        throw apiError(RESTJSONErrorCodes.MissingPermissions);
      },
    });

    await run(t.service, [
      makeGuild("1"),
      makeGuild("2"),
      makeGuild("3", { canSend: false }),
      makeGuild("4"),
    ]);

    expect(t.sleep).toHaveBeenCalledTimes(2);
    expect(t.sleep).toHaveBeenCalledWith(100);
  });

  test("a permanent 4xx is marked failed with its code", async () => {
    const t = setup({
      send: async () => {
        throw apiError(RESTJSONErrorCodes.MissingPermissions);
      },
    });

    await run(t.service, [makeGuild("1")]);

    expect(t.completed).toEqual([
      [
        POST_A,
        "1",
        {
          status: "failed",
          errorCode: String(RESTJSONErrorCodes.MissingPermissions),
        },
      ],
    ]);
  });

  test.each([
    ["a 5xx", () => new HTTPError(502, "Bad Gateway", "POST", "/x", {})],
    ["a 429", () => apiError(0, 429)],
    ["a network error", () => new TypeError("fetch failed")],
  ])("%s is left for a later retry", async (_name, makeError) => {
    const t = setup({
      send: async () => {
        throw makeError();
      },
    });

    await run(t.service, [makeGuild("1")]);

    expect(t.completed[0][2].status).toBe("retry");
    expect(t.recordRelay).toHaveBeenCalledWith("retry");
  });

  test("the last attempt of a temporary error is marked failed", async () => {
    const t = setup({
      claim: () => ({ kind: "claimed", attempt: 5 }),
      send: async () => {
        throw new HTTPError(503, "Unavailable", "POST", "/x", {});
      },
    });

    await run(t.service, [makeGuild("1")]);

    expect(t.completed[0][2]).toEqual({
      status: "failed",
      errorCode: "http_503",
    });
  });

  test("a failing post doesn't block the next post", async () => {
    const t = setup({
      posts: [post(POST_A), post(POST_B)],
      introDone: true,
    });
    let first = true;
    t.get.mockImplementation(async (route: string) => {
      if (first) {
        first = false;
        throw new Error("source lookup failed");
      }
      return route === `/channels/${SOURCE_CHANNEL}`
        ? { id: SOURCE_CHANNEL, guild_id: SOURCE_GUILD }
        : {};
    });

    await run(t.service, [makeGuild("1")]);

    expect(t.completed.map(([postId]) => postId)).toEqual([POST_B]);
  });

  test("a database error ends the run", async () => {
    const t = setup({ posts: [post(POST_A), post(POST_B)] });
    t.repository.claimDelivery.mockImplementation(async () => {
      throw new Error("db down");
    });

    await expect(run(t.service, [makeGuild("1")])).rejects.toThrow(
      "sushii updates database call failed",
    );
    expect(t.repository.findPendingTargets).toHaveBeenCalledTimes(1);
  });

  test("a source deleted mid-run stops and removes the post once the source confirms it", async () => {
    const t = setup({
      send: async () => {
        throw apiError(RESTJSONErrorCodes.UnknownMessage, 404);
      },
      sourceMessage: async () => {
        throw apiError(RESTJSONErrorCodes.UnknownMessage, 404);
      },
    });

    await run(t.service, [makeGuild("1"), makeGuild("2")]);

    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.repository.deletePost).toHaveBeenCalledWith(POST_A);
    expect(t.completed).toEqual([]);
  });

  test("a 10008 on the forward with a readable source never deletes the post", async () => {
    const t = setup({
      introDone: true,
      send: async () => {
        throw apiError(RESTJSONErrorCodes.UnknownMessage, 404);
      },
    });

    await run(t.service, [makeGuild("1"), makeGuild("2")]);

    expect(t.repository.deletePost).not.toHaveBeenCalled();
    expect(t.completed.map(([, guildId, r]) => [guildId, r.status])).toEqual([
      ["1", "failed"],
      ["2", "failed"],
    ]);
  });

  test("a possible bad reference checks the source at most once per post per run", async () => {
    const t = setup({
      introDone: true,
      send: async () => {
        throw apiError(RESTJSONErrorCodes.InvalidFormBodyOrContentType, 400);
      },
    });
    const sourceChecks = () =>
      t.get.mock.calls.filter(([route]) => route.includes("/messages/")).length;

    await run(t.service, [makeGuild("1"), makeGuild("2"), makeGuild("3")]);
    expect(sourceChecks()).toBe(1);
    expect(t.completed.every(([, , r]) => r.status === "failed")).toBe(true);

    t.repository.findPendingTargets.mockImplementation(async () => [
      { guildId: "4", channelId: CHANNEL },
    ]);
    await run(t.service, [makeGuild("4")]);
    expect(sourceChecks()).toBe(2);
  });

  test("an unreadable source pauses the post for 10 minutes and warns once", async () => {
    const t = setup({
      send: async () => {
        throw apiError(
          RESTJSONErrorCodes.CannotForwardMessageWithUnreadableContent,
          400,
        );
      },
    });
    const guilds = [makeGuild("1"), makeGuild("2")];

    await run(t.service, guilds);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.repository.releaseClaim).toHaveBeenCalledWith(POST_A, "1");
    expect(t.completed).toEqual([]);

    t.clock.now = new Date(t.clock.now.getTime() + 5 * 60 * 1000);
    await run(t.service, guilds);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.warn).toHaveBeenCalledTimes(1);

    t.clock.now = new Date(t.clock.now.getTime() + 6 * 60 * 1000);
    await run(t.service, guilds);
    expect(t.post).toHaveBeenCalledTimes(2);
  });

  test("a failed source server lookup pauses the post", async () => {
    const t = setup();
    t.get.mockImplementation(async () => {
      throw apiError(RESTJSONErrorCodes.MissingAccess);
    });

    await run(t.service, [makeGuild("1")]);
    await run(t.service, [makeGuild("1")]);

    expect(t.repository.claimDelivery).not.toHaveBeenCalled();
    expect(t.get).toHaveBeenCalledTimes(1);
    expect(t.warn).toHaveBeenCalledTimes(1);
  });

  test("only posts from the last 48 hours are relayed", async () => {
    const t = setup();

    await run(t.service, [makeGuild("1")]);

    expect(t.repository.findPostsSince).toHaveBeenCalledWith(
      new Date(t.clock.now.getTime() - 48 * 60 * 60 * 1000),
    );
  });

  test("missing access on a readable source is the target's problem", async () => {
    const t = setup({
      introDone: true,
      send: async (channel) => {
        void channel;
        throw apiError(RESTJSONErrorCodes.MissingAccess);
      },
    });

    await run(t.service, [makeGuild("1"), makeGuild("2")]);

    expect(t.completed.map(([, guildId, r]) => [guildId, r.status])).toEqual([
      ["1", "failed"],
      ["2", "failed"],
    ]);
  });

  test("missing access because the source went away stops the post", async () => {
    const t = setup({
      send: async () => {
        throw apiError(RESTJSONErrorCodes.MissingAccess);
      },
      sourceMessage: async () => {
        throw apiError(RESTJSONErrorCodes.MissingAccess);
      },
    });

    await run(t.service, [makeGuild("1"), makeGuild("2")]);

    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.repository.releaseClaim).toHaveBeenCalledWith(POST_A, "1");
  });

  test("a post deleted by another cluster stops at the claim", async () => {
    const t = setup({ claim: () => ({ kind: "post_deleted" }) });

    await run(t.service, [makeGuild("1"), makeGuild("2")]);

    expect(t.repository.claimDelivery).toHaveBeenCalledTimes(1);
    expect(t.post).not.toHaveBeenCalled();
  });

  test("an unavailable guild is skipped without a claim", async () => {
    const t = setup();

    await run(t.service, [makeGuild("1", { available: false })]);

    expect(t.repository.claimDelivery).not.toHaveBeenCalled();
  });

  test("missing permissions are skipped without a send", async () => {
    const t = setup();

    await run(t.service, [makeGuild("1", { canSend: false })]);

    expect(t.post).not.toHaveBeenCalled();
    expect(t.completed).toEqual([
      [POST_A, "1", { status: "skipped", errorCode: "missing_permissions" }],
    ]);
  });

  test("stops when the deployment becomes inactive", async () => {
    let active = true;
    const t = setup({
      introDone: true,
      send: async () => {
        active = false;
        return { id: "700000000000000001" };
      },
    });

    await run(t.service, [makeGuild("1"), makeGuild("2")], () => active);

    expect(t.post).toHaveBeenCalledTimes(1);
  });
});
