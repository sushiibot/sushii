import { sql } from "drizzle-orm";

import { checkBearerToken } from "./auth.ts";
import type { Db } from "./db.ts";

const ANALYTICS_VIEWS = new Set([
  "usage_weekly",
  "usage_daily",
  "usage_current_week",
  "command_usage",
  "server_activity",
  "retention_weekly",
  "prompt_funnel_weekly",
  "update_reach",
  "proof_weekly",
]);

const MAX_ROWS = 5000;
const UNDEFINED_TABLE = "42P01";

function isMissingView(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return cause?.code === UNDEFINED_TABLE;
}

export const ANALYTICS_PATH_PREFIX = "/analytics/";

/** Unset token turns the endpoints off. */
export async function handleAnalyticsRequest(
  req: Request,
  pathname: string,
  db: Pick<Db, "execute">,
  token: string | undefined,
): Promise<Response> {
  if (!token || req.method !== "GET") {
    return new Response("Not Found", { status: 404 });
  }
  if (!checkBearerToken(req, token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const view = pathname.slice(ANALYTICS_PATH_PREFIX.length);
  if (!ANALYTICS_VIEWS.has(view)) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const result = await db.execute(
      sql.raw(
        `SELECT * FROM analytics.${view} ORDER BY 1 DESC LIMIT ${MAX_ROWS}`,
      ),
    );
    return Response.json(result.rows);
  } catch (err) {
    // sushii-mcp can release ahead of the bot migration that creates the views.
    if (isMissingView(err)) {
      return Response.json([]);
    }
    throw err;
  }
}
