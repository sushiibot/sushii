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
        "All guilds that currently have a user banned, with guild name, member count, ban reason, and timestamp. Guilds that opted out of cross-server sharing show '[redacted]' for name and null for reason — the ban is still counted.",
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
