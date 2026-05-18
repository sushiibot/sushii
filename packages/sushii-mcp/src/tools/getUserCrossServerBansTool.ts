import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Db } from "../db.ts";
import { getUserCrossServerBans } from "../queries/getUserCrossServerBans.ts";

export function registerGetUserCrossServerBansTool(
  server: McpServer,
  db: Db,
): void {
  server.registerTool(
    "get_user_cross_server_bans",
    {
      description:
        "Get all guilds that currently have a user banned. Results include guild metadata and apply opt-out redaction: guilds with lookupDetailsOptIn=false will have guildName set to '[redacted]' and reason set to null.",
      inputSchema: {
        user_id: z.string().describe("Discord user ID"),
      },
    },
    async (args) => {
      const results = await getUserCrossServerBans(db, args.user_id);

      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    },
  );
}
