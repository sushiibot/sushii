import { describe, expect, mock, test } from "bun:test";

import { handleAnalyticsRequest } from "./analytics.ts";

const TOKEN = "t".repeat(32);

function get(token: string | null): Request {
  return new Request("http://mcp/analytics/usage_weekly", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function dbReturning(rows: unknown[]) {
  return { execute: mock(async () => ({ rows })) } as never;
}

describe("handleAnalyticsRequest", () => {
  test("returns the rows of an allow-listed view", async () => {
    const rows = [{ week: "2026-11-02", feature: "all" }];
    const res = await handleAnalyticsRequest(
      get(TOKEN),
      "/analytics/usage_weekly",
      dbReturning(rows),
      TOKEN,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  test("rejects a wrong or missing token", async () => {
    for (const token of ["wrong", null]) {
      const res = await handleAnalyticsRequest(
        get(token),
        "/analytics/usage_weekly",
        dbReturning([]),
        TOKEN,
      );
      expect(res.status).toBe(401);
    }
  });

  test("never queries a name outside the allow-list", async () => {
    const db = dbReturning([]);
    const res = await handleAnalyticsRequest(
      get(TOKEN),
      "/analytics/usage_weekly;drop table x",
      db,
      TOKEN,
    );

    expect(res.status).toBe(404);
    expect(
      (db as { execute: ReturnType<typeof mock> }).execute,
    ).not.toHaveBeenCalled();
  });

  test("is off without a token", async () => {
    const res = await handleAnalyticsRequest(
      get(TOKEN),
      "/analytics/usage_weekly",
      dbReturning([]),
      undefined,
    );
    expect(res.status).toBe(404);
  });

  test("returns nothing until the views exist", async () => {
    const db = {
      execute: mock(async () => {
        throw new Error("Failed query", { cause: { code: "42P01" } });
      }),
    } as never;

    const res = await handleAnalyticsRequest(
      get(TOKEN),
      "/analytics/usage_weekly",
      db,
      TOKEN,
    );

    expect(await res.json()).toEqual([]);
  });

  test("still fails on any other database error", async () => {
    const db = {
      execute: mock(async () => {
        throw new Error("Failed query", { cause: { code: "42501" } });
      }),
    } as never;

    await expect(
      handleAnalyticsRequest(get(TOKEN), "/analytics/usage_weekly", db, TOKEN),
    ).rejects.toThrow("Failed query");
  });
});
