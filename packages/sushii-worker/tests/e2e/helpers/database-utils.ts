import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Logger } from "pino";
import { sql } from "drizzle-orm";

export interface DeploymentRecord {
  name: string;
  updated_at: Date;
}

export class DatabaseUtils {
  private readonly logger: Logger;
  private readonly pool: Pool;
  private readonly db: ReturnType<typeof drizzle>;

  constructor(logger: Logger, connectionString: string) {
    this.logger = logger;
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.db = drizzle(this.pool);
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<void> {
    try {
      await this.db.execute(sql`SELECT 1`);
      this.logger.info("Database connection test successful");
    } catch (err) {
      this.logger.error({ err }, "Database connection test failed");
      throw err;
    }
  }

  /**
   * Get active deployment from database
   */
  async getActiveDeployment(): Promise<DeploymentRecord | null> {
    try {
      const result = await this.db.execute(
        sql`SELECT name, CURRENT_TIMESTAMP as updated_at FROM app_private.active_deployment LIMIT 1`,
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        name: row.name as string,
        updated_at: new Date(row.updated_at as string),
      };
    } catch (err) {
      this.logger.error({ err }, "Failed to get active deployment");
      throw err;
    }
  }

  /**
   * Set active deployment in database
   */
  async setActiveDeployment(deploymentName: string): Promise<void> {
    try {
      this.db.transaction(async (tx) => {
        // Ensure the deployment name is not empty
        await tx.execute(
          sql`INSERT INTO app_private.active_deployment (name) 
            VALUES (${deploymentName})
            ON CONFLICT (id) DO UPDATE SET name = ${deploymentName}`,
        );

        // Notify for bots to pick it up
        await tx.execute(sql`NOTIFY deployment_changed, ${deploymentName}`);
      });

      this.logger.info({ deploymentName }, "Set active deployment in database");
    } catch (err) {
      this.logger.error(
        { err, deploymentName },
        "Failed to set active deployment",
      );
      throw err;
    }
  }

  /**
   * Get all deployment records
   */
  async getAllDeployments(): Promise<DeploymentRecord[]> {
    try {
      const result = await this.db.execute(
        sql`SELECT name, CURRENT_TIMESTAMP as updated_at FROM app_private.active_deployment`,
      );

      return result.rows.map((row) => ({
        name: row.name as string,
        updated_at: new Date(row.updated_at as string),
      }));
    } catch (err) {
      this.logger.error({ err }, "Failed to get all deployments");
      throw err;
    }
  }

  /**
   * Clear deployment table (for test cleanup)
   */
  async clearDeployments(): Promise<void> {
    try {
      await this.db.execute(sql`DELETE FROM app_private.active_deployment`);
      this.logger.info("Cleared deployment table");
    } catch (err) {
      this.logger.error({ err }, "Failed to clear deployment table");
      throw err;
    }
  }

  /**
   * Wait for deployment change to be reflected in database
   */
  async waitForDeploymentChange(
    expectedDeployment: string,
    timeoutMs = 10000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const active = await this.getActiveDeployment();

      if (active?.name === expectedDeployment) {
        this.logger.info(
          { expectedDeployment },
          "Deployment change detected in database",
        );
        return;
      }

      this.logger.debug(
        { expectedDeployment, currentDeployment: active?.name },
        "Waiting for deployment change",
      );

      await this.sleep(1000);
    }

    throw new Error(
      `Deployment did not change to ${expectedDeployment} within ${timeoutMs}ms`,
    );
  }

  /**
   * Check if deployment table exists and has correct schema
   */
  async checkDeploymentTableSchema(): Promise<boolean> {
    try {
      const result = await this.db.execute(
        sql`SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'app_private' 
            AND table_name = 'active_deployment'
            ORDER BY ordinal_position`,
      );

      const columns = result.rows.map((row) => ({
        name: row.column_name as string,
        type: row.data_type as string,
      }));

      // Check for expected columns
      const hasId = columns.some((col) => col.name === "id");
      const hasName = columns.some((col) => col.name === "name");

      if (!hasId || !hasName) {
        this.logger.warn(
          { columns },
          "Active deployment table missing expected columns",
        );
        return false;
      }

      return true;
    } catch (err) {
      this.logger.error({ err }, "Failed to check deployment table schema");
      return false;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info("Database connection closed");
    } catch (err) {
      this.logger.error({ err }, "Failed to close database connection");
      throw err;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
