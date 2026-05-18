function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export interface Config {
  databaseUrl: string;
  mcpAuthToken: string;
  port: number;
  logLevel: string;
  dbMaxConnections: number;
}

export const config: Config = {
  databaseUrl: required("DATABASE_URL"),
  mcpAuthToken: required("MCP_AUTH_TOKEN"),
  port: parseInt(optional("PORT", "3100"), 10),
  logLevel: optional("LOG_LEVEL", "info"),
  dbMaxConnections: parseInt(optional("DB_MAX_CONNECTIONS", "5"), 10),
};
