import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Db } from "../db.ts";
import { getGuildRecentCases } from "../queries/getGuildRecentCases.ts";

export function registerGetGuildRecentCasesTool(
  server: McpServer,
  db: Db,
): void {
  server.registerTool(
    "get_guild_recent_cases",
    {
      description:
        "Get the most recent moderation cases across all users in a guild, ordered by case ID descending. Includes pending cases unlike get_user_mod_history.",
      inputSchema: {
        guild_id: z.string().describe("Discord guild (server) ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .optional()
          .describe("Maximum number of results (default 25, max 100)"),
      },
    },
    async (args) => {
      const limit = args.limit ?? 25;
      const results = await getGuildRecentCases(db, args.guild_id, limit);

      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    },
  );
}
