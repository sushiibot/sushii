import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { Wait } from "testcontainers";

import * as schema from "@/infrastructure/database/schema";

export class PostgresTestDatabase {
  private container: StartedPostgreSqlContainer | null = null;
  private client: Client | null = null;
  private db: NodePgDatabase<typeof schema> | null = null;

  async initialize(): Promise<NodePgDatabase<typeof schema>> {
    console.log("Creating PostgreSQL test container...");
    // Start PostgreSQL container
    this.container = await new PostgreSqlContainer("postgres:17-bookworm")
      .withDatabase("sushii_test")
      .withUsername("test_user")
      .withPassword("test_pass")
      .withWaitStrategy(Wait.forHealthCheck())
      .start();

    console.log("PostgreSQL container started successfully");

    // Connect to the database
    this.client = new Client({
      connectionString: this.container.getConnectionUri(),
    });
    await this.client.connect();

    this.db = drizzle({ client: this.client, schema });

    // Run database initialization seed
    await this.runInitSql();

    // Run migrations
    await migrate(this.db, { migrationsFolder: "./drizzle" });

    return this.db;
  }

  private async runInitSql(): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");

    const initSqlPath = path.join(process.cwd(), "drizzle", "init.sql");
    const initSql = fs.readFileSync(initSqlPath, "utf8");

    // Execute the entire init.sql file as one query
    await this.client.query(initSql);
  }

  async close(): Promise<void> {
    await this.client?.end();
    await this.container?.stop();
  }
}
