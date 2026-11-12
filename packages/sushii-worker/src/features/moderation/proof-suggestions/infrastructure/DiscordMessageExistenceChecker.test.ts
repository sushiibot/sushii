import { describe, expect, mock, test } from "bun:test";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { REST } from "discord.js";
import pino from "pino";
import type { Logger } from "pino";

import { DiscordMessageExistenceChecker } from "./DiscordMessageExistenceChecker";

const CHANNEL = "300000000000000001";

function id(n: number): string {
  return (500000000000000000n + BigInt(n)).toString();
}

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "err" },
    code,
    404,
    "GET",
    "/x",
    {},
  );
}

function fakeRest(opts: {
  history: number[];
  listFails?: boolean;
  /** Overrides the listed page; defaults to two messages either side of `around`. */
  page?: number[];
  singleErrors?: Record<string, number>;
}) {
  const calls: string[] = [];
  const rest = {
    get: async (route: string, options?: { query?: URLSearchParams }) => {
      calls.push(route);
      if (route.endsWith("/messages")) {
        if (opts.listFails) {
          throw apiError(RESTJSONErrorCodes.MissingAccess);
        }

        if (opts.page) {
          return opts.page.map((n) => ({ id: id(n) }));
        }

        const around = BigInt(options?.query?.get("around") ?? "0");
        const all = opts.history.map((n) => BigInt(id(n)));
        const before = all.filter((n) => n < around).slice(-2);
        const after = all.filter((n) => n >= around).slice(0, 2);
        return [...before, ...after].map((n) => ({ id: n.toString() }));
      }

      const messageId = route.split("/").pop() ?? "";
      const code = opts.singleErrors?.[messageId];
      if (code) {
        throw apiError(code);
      }

      if (!opts.history.some((n) => id(n) === messageId)) {
        throw apiError(RESTJSONErrorCodes.UnknownMessage);
      }

      return { id: messageId };
    },
  } as unknown as REST;

  return { rest, calls };
}

describe("DiscordMessageExistenceChecker.checkMany", () => {
  test("infers deletions inside a listed page; fetches ids outside it one by one", async () => {
    const { rest, calls } = fakeRest({ history: [1, 2, 4, 5, 9, 12] });
    const checker = new DiscordMessageExistenceChecker(
      rest,
      pino({ level: "silent" }),
    );

    const result = await checker.checkMany(CHANNEL, [
      id(20),
      id(9),
      id(3),
      id(11),
      id(4),
      id(2),
    ]);

    expect(Object.fromEntries(result)).toEqual({
      [id(2)]: "exists",
      [id(3)]: "unknown_message",
      [id(4)]: "exists",
      [id(9)]: "exists",
      [id(11)]: "unknown_message",
      [id(20)]: "unknown_message",
    });
    expect(calls.filter((c) => c.endsWith("/messages"))).toHaveLength(2);
    expect(calls.filter((c) => !c.endsWith("/messages"))).toHaveLength(1);
  });

  test("falls back to single fetches when listing fails", async () => {
    const { rest, calls } = fakeRest({
      history: [1],
      listFails: true,
      singleErrors: { [id(2)]: RESTJSONErrorCodes.MissingAccess },
    });
    const checker = new DiscordMessageExistenceChecker(
      rest,
      pino({ level: "silent" }),
    );

    const result = await checker.checkMany(CHANNEL, [id(1), id(2), id(3)]);

    expect(Object.fromEntries(result)).toEqual({
      [id(1)]: "exists",
      [id(2)]: "error",
      [id(3)]: "unknown_message",
    });
    expect(calls.filter((c) => !c.endsWith("/messages"))).toHaveLength(3);
  });

  test("an empty page falls back to single fetches", async () => {
    const { rest, calls } = fakeRest({ history: [1], page: [] });
    const checker = new DiscordMessageExistenceChecker(
      rest,
      pino({ level: "silent" }),
    );

    const result = await checker.checkMany(CHANNEL, [id(1), id(2)]);

    expect(Object.fromEntries(result)).toEqual({
      [id(1)]: "exists",
      [id(2)]: "unknown_message",
    });
    expect(calls.filter((c) => c.endsWith("/messages"))).toHaveLength(1);
    expect(calls.filter((c) => !c.endsWith("/messages"))).toHaveLength(2);
  });

  test("ids at or past the page edges are never inferred deleted", async () => {
    const { rest, calls } = fakeRest({ history: [1, 2, 9, 10], page: [2, 9] });
    const checker = new DiscordMessageExistenceChecker(
      rest,
      pino({ level: "silent" }),
    );

    const result = await checker.checkMany(CHANNEL, [
      id(1),
      id(2),
      id(5),
      id(9),
      id(10),
    ]);

    expect(Object.fromEntries(result)).toEqual({
      [id(1)]: "exists",
      [id(2)]: "exists",
      [id(5)]: "unknown_message",
      [id(9)]: "exists",
      [id(10)]: "exists",
    });
    expect(calls.filter((c) => !c.endsWith("/messages")).sort()).toEqual([
      `/channels/${CHANNEL}/messages/${id(1)}`,
      `/channels/${CHANNEL}/messages/${id(10)}`,
    ]);
  });

  test("a page holding one message infers nothing about its neighbours", async () => {
    const { rest, calls } = fakeRest({ history: [4, 5], page: [5] });
    const checker = new DiscordMessageExistenceChecker(
      rest,
      pino({ level: "silent" }),
    );

    const result = await checker.checkMany(CHANNEL, [id(4), id(5), id(6)]);

    expect(Object.fromEntries(result)).toEqual({
      [id(4)]: "exists",
      [id(5)]: "exists",
      [id(6)]: "unknown_message",
    });
    expect(calls.filter((c) => !c.endsWith("/messages")).sort()).toEqual([
      `/channels/${CHANNEL}/messages/${id(4)}`,
      `/channels/${CHANNEL}/messages/${id(6)}`,
    ]);
  });

  test("logs failures once per call", async () => {
    const { rest } = fakeRest({
      history: [],
      listFails: true,
      singleErrors: {
        [id(1)]: RESTJSONErrorCodes.MissingAccess,
        [id(2)]: RESTJSONErrorCodes.MissingAccess,
      },
    });
    const warn = mock(() => undefined);
    const logger = { warn } as unknown as Logger;
    const checker = new DiscordMessageExistenceChecker(rest, logger);

    const result = await checker.checkMany(CHANNEL, [id(1), id(2)]);

    expect([...result.values()]).toEqual(["error", "error"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: CHANNEL,
        failedMessageIds: [id(1), id(2)],
        listingFailed: true,
      }),
      "Could not check suggested proof messages",
    );
  });
});
