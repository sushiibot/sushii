import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Db } from "../db.ts";
import { getUserModHistory } from "../queries/getUserModHistory.ts";

export function registerGetUserModHistoryTool(server: McpServer, db: Db): void {
  server.registerTool(
    "get_user_mod_history",
    {
      description:
        "Get a user's moderation case history in a guild, ordered by case ID descending (most recent first). Excludes pending cases.",
      inputSchema: {
        guild_id: z.string().describe("Discord guild (server) ID"),
        user_id: z.string().describe("Discord user ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .optional()
          .describe("Maximum number of results (default 50, max 100)"),
        before_case_id: z
          .string()
          .optional()
          .describe("Return only cases with case_id less than this value (cursor pagination)"),
      },
    },
    async (args) => {
      const limit = args.limit ?? 50;
      const results = await getUserModHistory(
        db,
        args.guild_id,
        args.user_id,
        limit,
        args.before_case_id,
      );

      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    },
  );
}
