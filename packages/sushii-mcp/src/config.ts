function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export interface Config {
  port: number;
  logLevel: string;
  dbMaxConnections: number;
}

export const config: Config = {
  port: parseInt(optional("PORT", "3100"), 10),
  logLevel: optional("LOG_LEVEL", "info"),
  dbMaxConnections: parseInt(optional("DB_MAX_CONNECTIONS", "5"), 10),
};
