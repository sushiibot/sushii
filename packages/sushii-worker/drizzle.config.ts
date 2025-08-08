import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/infrastructure/database/schema.ts",
  schemaFilter: ["app_public", "app_private", "app_hidden"],
  dialect: "postgresql",
  // Not necessary for postgres, only for databases that don't support multiple
  // DDL alteration statements in one transaction
  breakpoints: false,
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
