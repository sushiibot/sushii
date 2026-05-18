import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { checkBearerToken } from "./auth.ts";
import { config } from "./config.ts";
import { initDatabase } from "./db.ts";
import { logger } from "./logger.ts";
import { createMcpServer } from "./server.ts";

const db = initDatabase(config.databaseUrl, config.dbMaxConnections);

Bun.serve({
  port: config.port,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/mcp") {
      if (!checkBearerToken(req, config.mcpAuthToken)) {
        return new Response("Unauthorized", { status: 401 });
      }

      const server = createMcpServer(db);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      return transport.handleRequest(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

logger.info({ port: config.port }, "sushii-mcp listening");
