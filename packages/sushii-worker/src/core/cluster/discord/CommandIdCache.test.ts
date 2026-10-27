import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Client } from "discord.js";
import { ApplicationCommandType, Routes } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { config } from "@/shared/infrastructure/config";
import log from "@/shared/infrastructure/logger";
import type { InteractionMetrics } from "@/shared/infrastructure/metrics/InteractionMetrics";
import type { SlashCommandHandler } from "@/shared/presentation/handlers";

import {
  CommandIdCache,
  FAILED_REFETCH_INTERVAL_MS,
  type KnownCommands,
  MISS_REFETCH_INTERVAL_MS,
  type RegisteredCommand,
} from "./CommandIdCache";
import InteractionRouter from "./InteractionRouter";

const APP_ID = "100000000000000001";
const GUILD_ID = "200000000000000002";
const ROLEMENU_ID = "300000000000000003";
const NOTES_ID = "300000000000000004";

const ROLEMENU: RegisteredCommand = {
  id: ROLEMENU_ID,
  name: "rolemenu",
  type: ApplicationCommandType.ChatInput,
};

function knownCommands(
  names: string[],
  guildNames: string[] = [],
): KnownCommands {
  return {
    isKnown: (name, guildId) =>
      names.includes(name) ||
      (guildId === GUILD_ID && guildNames.includes(name)),
    guildIds: () => (guildNames.length > 0 ? [GUILD_ID] : []),
  };
}

function makeCache(
  get: (route: string) => Promise<unknown>,
  known: KnownCommands = knownCommands(["rolemenu"]),
  now: () => number = Date.now,
) {
  const rest = { get: mock(get) };
  const cache = new CommandIdCache(rest, APP_ID, known, now);
  return { cache, rest };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function silenceWarn() {
  return spyOn(log, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  mock.restore();
});

describe("CommandIdCache.mention", () => {
  test("renders a known root command", () => {
    const { cache } = makeCache(async () => []);
    cache.setGlobal([ROLEMENU]);

    expect(cache.mention("rolemenu")).toBe(`</rolemenu:${ROLEMENU_ID}>`);
  });

  test("renders a subcommand path with the root command's ID", () => {
    const { cache } = makeCache(async () => []);
    cache.setGlobal([ROLEMENU]);

    expect(cache.mention("rolemenu create")).toBe(
      `</rolemenu create:${ROLEMENU_ID}>`,
    );
  });

  test("falls back to inline code for an unknown name", () => {
    const { cache, rest } = makeCache(async () => []);
    cache.setGlobal([ROLEMENU]);

    expect(cache.mention("nope sub")).toBe("`/nope sub`");
    expect(rest.get).not.toHaveBeenCalled();
  });

  test("does not mention a context menu command", () => {
    const { cache } = makeCache(async () => [], knownCommands([]));
    cache.setGlobal([
      { id: ROLEMENU_ID, name: "User Info", type: ApplicationCommandType.User },
    ]);

    expect(cache.mention("User Info")).toBe("`/User Info`");
  });

  test("prefers the slash command when a context menu shares its name", () => {
    const { cache } = makeCache(async () => []);
    cache.setGlobal([
      ROLEMENU,
      { id: NOTES_ID, name: "rolemenu", type: ApplicationCommandType.Message },
    ]);

    expect(cache.mention("rolemenu")).toBe(`</rolemenu:${ROLEMENU_ID}>`);
  });

  test("looks up guild-scoped commands only for that guild", () => {
    const { cache } = makeCache(
      async () => [],
      knownCommands(["rolemenu"], ["notes"]),
    );
    cache.setGlobal([ROLEMENU]);
    cache.setGuild(GUILD_ID, [{ id: NOTES_ID, name: "notes" }]);

    expect(cache.mention("notes add", GUILD_ID)).toBe(
      `</notes add:${NOTES_ID}>`,
    );
    expect(cache.mention("rolemenu", GUILD_ID)).toBe(
      `</rolemenu:${ROLEMENU_ID}>`,
    );
    expect(cache.mention("notes add")).toBe("`/notes add`");
  });

  test("a guild slash command wins over a global one with the same name", () => {
    const { cache } = makeCache(async () => []);
    cache.setGlobal([ROLEMENU]);
    cache.setGuild(GUILD_ID, [{ id: NOTES_ID, name: "rolemenu" }]);

    expect(cache.mention("rolemenu", GUILD_ID)).toBe(`</rolemenu:${NOTES_ID}>`);
  });

  test("a guild context menu does not shadow a global slash command", () => {
    const { cache } = makeCache(async () => []);
    cache.setGlobal([ROLEMENU]);
    cache.setGuild(GUILD_ID, [
      { id: NOTES_ID, name: "rolemenu", type: ApplicationCommandType.Message },
    ]);

    expect(cache.mention("rolemenu", GUILD_ID)).toBe(
      `</rolemenu:${ROLEMENU_ID}>`,
    );
  });
});

describe("CommandIdCache.refresh", () => {
  test("fills global and guild commands", async () => {
    const { cache, rest } = makeCache(
      async (route) =>
        route === Routes.applicationCommands(APP_ID)
          ? [ROLEMENU]
          : [{ id: NOTES_ID, name: "notes", type: 1 }],
      knownCommands(["rolemenu"], ["notes"]),
    );

    await cache.refresh();

    expect(rest.get).toHaveBeenCalledWith(Routes.applicationCommands(APP_ID));
    expect(rest.get).toHaveBeenCalledWith(
      Routes.applicationGuildCommands(APP_ID, GUILD_ID),
    );
    expect(cache.mention("rolemenu")).toBe(`</rolemenu:${ROLEMENU_ID}>`);
    expect(cache.mention("notes", GUILD_ID)).toBe(`</notes:${NOTES_ID}>`);
  });

  test("logs a failure at warn and keeps the fallback", async () => {
    const warn = silenceWarn();
    const err = new Error("discord down");
    const { cache } = makeCache(async () => {
      throw err;
    });

    await cache.refresh();

    expect(warn).toHaveBeenCalledWith(
      { err },
      "failed to fetch global command IDs",
    );
    expect(cache.mention("rolemenu")).toBe("`/rolemenu`");
  });

  test("a failed refresh after a good one keeps the old IDs", async () => {
    silenceWarn();
    let fail = false;
    const { cache } = makeCache(async () => {
      if (fail) {
        throw new Error("discord down");
      }
      return [ROLEMENU];
    });

    await cache.refresh();
    fail = true;
    await cache.refresh();

    expect(cache.mention("rolemenu")).toBe(`</rolemenu:${ROLEMENU_ID}>`);
  });

  test("shares one fetch between overlapping calls", async () => {
    const pending = deferred<unknown>();
    const { cache, rest } = makeCache(() => pending.promise);

    const first = cache.refresh();
    const second = cache.refresh();
    pending.resolve([ROLEMENU]);
    await Promise.all([first, second]);

    expect(rest.get).toHaveBeenCalledTimes(1);
  });
});

describe("CommandIdCache miss refetch", () => {
  test("after a success the 5 minute window holds", async () => {
    let now = 1_000_000;
    const { cache, rest } = makeCache(
      async () => [],
      knownCommands(["rolemenu"]),
      () => now,
    );

    expect(cache.mention("rolemenu")).toBe("`/rolemenu`");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(1);

    now += MISS_REFETCH_INTERVAL_MS - 1;
    cache.mention("rolemenu");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(1);

    now += 1;
    cache.mention("rolemenu");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(2);
  });

  test("concurrent misses during a pending refresh start one fetch", async () => {
    const pending = deferred<unknown>();
    const { cache, rest } = makeCache(() => pending.promise);

    cache.mention("rolemenu");
    cache.mention("rolemenu");
    cache.mention("rolemenu create");
    pending.resolve([ROLEMENU]);
    await flush();

    expect(rest.get).toHaveBeenCalledTimes(1);
    expect(cache.mention("rolemenu")).toBe(`</rolemenu:${ROLEMENU_ID}>`);
  });

  test("after a failure retries 30 seconds after the refresh ends", async () => {
    silenceWarn();
    let now = 1_000_000;
    const pending = deferred<unknown>();
    const { cache, rest } = makeCache(
      () => pending.promise,
      knownCommands(["rolemenu"]),
      () => now,
    );

    cache.mention("rolemenu");
    now += 10_000;
    pending.reject(new Error("discord down"));
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(1);

    now += FAILED_REFETCH_INTERVAL_MS - 1;
    cache.mention("rolemenu");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(1);

    now += 1;
    cache.mention("rolemenu");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(2);
  });

  test("a failed guild fetch keeps its IDs and the normal window", async () => {
    const warn = silenceWarn();
    let now = 1_000_000;
    const otherGuildId = "200000000000000005";
    const err = new Error("Missing Access");
    let round = 1;
    const { cache, rest } = makeCache(
      async (route) => {
        if (route === Routes.applicationCommands(APP_ID)) {
          return [ROLEMENU];
        }
        if (route === Routes.applicationGuildCommands(APP_ID, GUILD_ID)) {
          if (round === 2) {
            throw err;
          }
          return [{ id: NOTES_ID, name: "notes", type: 1 }];
        }
        return [
          { id: `30000000000000000${round + 5}`, name: "notes", type: 1 },
        ];
      },
      {
        isKnown: (name) => name === "rolemenu" || name === "xp",
        guildIds: () => [GUILD_ID, otherGuildId],
      },
      () => now,
    );

    await cache.refresh();
    round = 2;
    now += MISS_REFETCH_INTERVAL_MS;
    await cache.refresh();
    expect(rest.get).toHaveBeenCalledTimes(6);

    expect(warn).toHaveBeenCalledWith(
      { err, guildId: GUILD_ID },
      "failed to fetch guild command IDs",
    );
    expect(cache.mention("notes", GUILD_ID)).toBe(`</notes:${NOTES_ID}>`);
    expect(cache.mention("notes", otherGuildId)).toBe(
      "</notes:300000000000000007>",
    );

    now += FAILED_REFETCH_INTERVAL_MS;
    cache.mention("xp");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(6);

    now += MISS_REFETCH_INTERVAL_MS - FAILED_REFETCH_INTERVAL_MS;
    cache.mention("xp");
    await flush();
    expect(rest.get).toHaveBeenCalledTimes(9);
  });

  test("a startup prime does not block the first miss refetch", async () => {
    const now = 1_000_000;
    const { cache, rest } = makeCache(
      async () => [],
      knownCommands(["rolemenu"]),
      () => now,
    );

    await cache.prime();
    expect(rest.get).toHaveBeenCalledTimes(1);

    rest.get.mockImplementation(async () => [ROLEMENU]);
    expect(cache.mention("rolemenu")).toBe("`/rolemenu`");
    await flush();

    expect(rest.get).toHaveBeenCalledTimes(2);
    expect(cache.mention("rolemenu")).toBe(`</rolemenu:${ROLEMENU_ID}>`);
  });
});

describe("InteractionRouter.register", () => {
  function makeRouter(put: (route: string) => Promise<unknown>) {
    spyOn(log, "info").mockImplementation(() => undefined);
    const rest = {
      put: mock(put),
      get: mock(async (): Promise<unknown> => []),
    };
    const router = new InteractionRouter(
      { rest } as unknown as Client,
      Object.create(null) as DeploymentService,
      Object.create(null) as InteractionMetrics,
    );
    router.addCommands(
      { command: { name: "rolemenu" } } as SlashCommandHandler,
      {
        command: { name: "notes" },
        registeredGuilds: [GUILD_ID],
      } as unknown as SlashCommandHandler,
    );
    return { router, rest };
  }

  test("fills the command ID cache from the PUT responses", async () => {
    const { router, rest } = makeRouter(async (route) =>
      route === Routes.applicationCommands(config.discord.applicationId)
        ? [ROLEMENU]
        : [{ id: NOTES_ID, name: "notes", type: 1 }],
    );

    await router.register();

    expect(rest.put).toHaveBeenCalledTimes(2);
    expect(router.commandIdCache.mention("rolemenu create")).toBe(
      `</rolemenu create:${ROLEMENU_ID}>`,
    );
    expect(router.commandIdCache.mention("notes", GUILD_ID)).toBe(
      `</notes:${NOTES_ID}>`,
    );
    expect(rest.get).not.toHaveBeenCalled();
  });

  test("a rejected PUT falls back, then one GET fills the cache", async () => {
    spyOn(log, "error").mockImplementation(() => undefined);
    const { router, rest } = makeRouter(async () => {
      throw new Error("discord down");
    });
    rest.get.mockImplementation(async () => [ROLEMENU]);

    await router.register();

    expect(router.commandIdCache.mention("rolemenu")).toBe("`/rolemenu`");
    expect(router.commandIdCache.mention("rolemenu")).toBe("`/rolemenu`");
    await flush();

    expect(rest.get).toHaveBeenCalledTimes(2);
    expect(rest.get).toHaveBeenCalledWith(
      Routes.applicationCommands(config.discord.applicationId),
    );
    expect(router.commandIdCache.mention("rolemenu")).toBe(
      `</rolemenu:${ROLEMENU_ID}>`,
    );
  });
});
