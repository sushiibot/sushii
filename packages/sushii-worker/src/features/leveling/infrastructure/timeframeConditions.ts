import { type SQL, sql } from "drizzle-orm";

import { userLevelsInAppPublic } from "@/infrastructure/database/schema";

import { TimeFrame } from "../domain/value-objects/TimeFrame";

type PeriodUnit = "day" | "week" | "month";

/**
 * last_msg is a `timestamp without time zone` holding UTC wall-clock time, so
 * the current period is computed from UTC "now". date_trunc('week') starts on
 * Monday (ISO 8601), matching UserLevel's ISO week reset logic.
 */
function currentUtcPeriod(unit: PeriodUnit): SQL {
  const periodStart = sql`date_trunc(${sql.raw(`'${unit}'`)}, (now() at time zone 'UTC'))`;
  const lastMsg = userLevelsInAppPublic.lastMsg;

  return sql`(${lastMsg} >= ${periodStart} and ${lastMsg} < ${periodStart} + ${sql.raw(`interval '1 ${unit}'`)})`;
}

export function getTimeframeConditions(timeframe: TimeFrame): SQL[] {
  switch (timeframe) {
    case TimeFrame.DAY:
      return [currentUtcPeriod("day")];
    case TimeFrame.WEEK:
      return [currentUtcPeriod("week")];
    case TimeFrame.MONTH:
      return [currentUtcPeriod("month")];
    case TimeFrame.ALL_TIME:
      return [];
  }
}
