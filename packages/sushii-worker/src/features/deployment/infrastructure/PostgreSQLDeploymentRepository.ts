import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { Logger } from "pino";

import { activeDeploymentInAppPrivate } from "@/infrastructure/database/schema";
import type { EventBus } from "@/shared/interfaces";

import type { DeploymentName } from "../domain/entities/Deployment";
import { Deployment } from "../domain/entities/Deployment";
import { DeploymentChanged } from "../domain/events/DeploymentChanged";
import type { DeploymentRepository } from "../domain/repositories/DeploymentRepository";

export class PostgreSQLDeploymentRepository implements DeploymentRepository {
  private client: Client;
  private db: NodePgDatabase;
  private readonly channelName = "deployment_changed";
  private isConnected = false;
  private currentDeploymentName: DeploymentName = "blue";

  constructor(
    private readonly connectionString: string,
    private readonly logger: Logger,
    private readonly eventBus: EventBus,
    private readonly applicationName: string,
  ) {
    this.client = new Client({
      connectionString: this.connectionString,
      application_name: this.applicationName,
    });

    // Create Drizzle instance using the same client
    this.db = drizzle(this.client);
  }

  async start(): Promise<void> {
    if (this.isConnected) {
      this.logger.warn("PostgreSQL deployment repository already started");
      return;
    }

    try {
      this.client.on("error", (err) => {
        this.logger.error({ err }, "PostgreSQL client error");
        this.isConnected = false;
      });

      this.client.on("end", () => {
        this.logger.info("PostgreSQL connection ended");
        this.isConnected = false;
      });

      this.client.on("notification", (msg) => {
        this.handleNotification(msg);
      });

      await this.client.connect();
      await this.client.query(`LISTEN ${this.channelName}`);

      this.isConnected = true;
      this.logger.info(
        { channel: this.channelName },
        "PostgreSQL deployment repository started",
      );
    } catch (error) {
      this.logger.error(
        { error },
        "Failed to start PostgreSQL deployment repository",
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.client.query(`UNLISTEN ${this.channelName}`);
      await this.client.end();

      this.isConnected = false;
      this.logger.info("PostgreSQL deployment repository stopped");
    } catch (error) {
      this.logger.error(
        { error },
        "Error stopping PostgreSQL deployment repository",
      );
    }
  }

  async getActive(): Promise<Deployment> {
    try {
      const result = await this.db
        .select()
        .from(activeDeploymentInAppPrivate)
        .limit(1);

      if (result.length === 0) {
        this.currentDeploymentName = "blue";
        return Deployment.create("blue"); // Default fallback
      }

      const deploymentName = result[0].name as DeploymentName;
      this.currentDeploymentName = deploymentName;
      return Deployment.fromPersistence(
        deploymentName,
        new Date(), // We don't store updatedAt in the current schema
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to get active deployment");
      throw err;
    }
  }

  private getCurrentActiveDeploymentName(): DeploymentName {
    return this.currentDeploymentName;
  }

  async setActive(deployment: Deployment): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        // Drizzle ORM upsert operation within transaction
        await tx
          .insert(activeDeploymentInAppPrivate)
          .values({
            name: deployment.name,
          })
          .onConflictDoUpdate({
            target: activeDeploymentInAppPrivate.id,
            set: {
              name: deployment.name,
            },
          });

        // Raw SQL NOTIFY within the same transaction, gets queued until commit
        // Note: deployment.name is enum-constrained so this is safe
        await tx.execute(
          sql.raw(`NOTIFY ${this.channelName}, '${deployment.name}'`),
        );
      });

      // Update local state only after transaction succeeds
      this.currentDeploymentName = deployment.name;
    } catch (err) {
      this.logger.error({ err }, "Failed to set active deployment");
      throw err;
    }
  }

  private handleNotification(msg: { channel: string; payload?: string }): void {
    try {
      if (msg.channel !== this.channelName) {
        this.logger.warn(
          { channel: msg.channel },
          "Received notification from unexpected channel",
        );
        return;
      }

      if (!msg.payload) {
        this.logger.warn("Received notification without payload");
        return;
      }

      const deploymentName = msg.payload as DeploymentName;
      if (deploymentName !== "blue" && deploymentName !== "green") {
        this.logger.error(
          { payload: msg.payload },
          "Invalid deployment name in notification",
        );

        return;
      }

      this.logger.info(
        { deployment: deploymentName },
        "Deployment change notification received",
      );

      // Publish event for application layer to handle
      // We don't know the previous deployment from the notification, so use the current one
      const currentDeployment = this.getCurrentActiveDeploymentName();
      this.eventBus.publish(
        new DeploymentChanged(currentDeployment, deploymentName),
      );
    } catch (err) {
      this.logger.error({ err }, "Error handling notification");
    }
  }
}
