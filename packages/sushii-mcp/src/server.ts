import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Db } from "./db.ts";
import { registerGetGuildRecentCasesTool } from "./tools/getGuildRecentCasesTool.ts";
import { registerGetUserCrossServerBansTool } from "./tools/getUserCrossServerBansTool.ts";
import { registerGetUserModHistoryTool } from "./tools/getUserModHistoryTool.ts";

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({
    name: "sushii-mcp",
    version: "1.0.0",
  });

  registerGetUserModHistoryTool(server, db);
  registerGetUserCrossServerBansTool(server, db);
  registerGetGuildRecentCasesTool(server, db);

  return server;
}
