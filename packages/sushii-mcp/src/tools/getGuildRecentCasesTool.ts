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
        "Most recent moderation actions across all users in the guild, newest first. Same fields as get_user_mod_history but guild-wide. Useful for understanding current enforcement activity and patterns.",
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
