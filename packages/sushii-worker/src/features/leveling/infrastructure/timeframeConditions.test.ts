import { describe, expect, it } from "bun:test";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { TimeFrame } from "../domain/value-objects/TimeFrame";
import { getTimeframeConditions } from "./timeframeConditions";

const dialect = new PgDialect();

function render(timeframe: TimeFrame): string {
  const conditions = getTimeframeConditions(timeframe);
  if (conditions.length === 0) {
    return "";
  }

  return dialect.sqlToQuery(and(...conditions)!).sql;
}

describe("getTimeframeConditions", () => {
  it("has no conditions for all time", () => {
    expect(getTimeframeConditions(TimeFrame.ALL_TIME)).toEqual([]);
  });

  it.each([
    [TimeFrame.DAY, "day"],
    [TimeFrame.WEEK, "week"],
    [TimeFrame.MONTH, "month"],
  ])("bounds %s to the current UTC period", (timeframe, unit) => {
    const query = render(timeframe);

    // last_msg is a UTC timestamp without time zone, so "now" must be UTC too.
    // date_trunc('week') uses ISO weeks (Monday start), matching the app logic
    // and avoiding the extract(week) / extract(year) mismatch at new year.
    const periodStart = `date_trunc('${unit}', (now() at time zone 'UTC'))`;
    expect(query).toContain(
      `"user_levels"."last_msg" >= ${periodStart}`,
    );
    expect(query).toContain(
      `"user_levels"."last_msg" < ${periodStart} + interval '1 ${unit}'`,
    );
    expect(query).not.toContain("extract");
  });
});
