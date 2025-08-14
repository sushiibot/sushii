import { sleep } from "bun";
import { configDotenv } from "dotenv";
import pino from "pino";

import { DatabaseUtils } from "./database-utils";
import { DockerUtils } from "./docker-utils";
import { HealthCheckUtils } from "./health-check-utils";

configDotenv();

export interface E2ETestEnvironment {
  dockerUtils: DockerUtils;
  databaseUtils: DatabaseUtils;
  healthCheckUtils: HealthCheckUtils;
  logger: pino.Logger;
}

export class DeploymentSetup {
  private readonly logger: pino.Logger;
  private readonly dockerUtils: DockerUtils;
  private readonly databaseUtils: DatabaseUtils;
  private readonly healthCheckUtils: HealthCheckUtils;

  constructor() {
    // Create silent logger for tests to avoid noise
    this.logger = pino({ level: "silent" });

    // Initialize utility classes
    this.dockerUtils = new DockerUtils(this.logger);
    this.databaseUtils = new DatabaseUtils(
      this.logger,
      "postgres://sushii_test:sushii_test@localhost:5433/sushii_test",
    );
    this.healthCheckUtils = new HealthCheckUtils(this.logger);
  }

  /**
   * Setup complete e2e test environment
   */
  async setupTestEnvironment(): Promise<E2ETestEnvironment> {
    // Start Docker containers
    await this.dockerUtils.startTestEnvironment();

    // Wait for database to be ready
    await this.dockerUtils.waitForContainerHealthy("sushii_db_test");

    // Test database connection
    await this.databaseUtils.testConnection();

    // Check deployment table schema
    // Poll for at least 30 seconds to ensure schema is ready, need to wait
    // for migrations to complete
    const startTime = Date.now();
    const timeout = 30000; // 30 seconds
    let hasValidSchema = false;

    while (Date.now() - startTime < timeout) {
      try {
        hasValidSchema = await this.databaseUtils.checkDeploymentTableSchema();
      } catch (error) {
        this.logger.warn(
          { error },
          "Deployment table schema check failed, retrying...",
        );

        await this.sleep(2000); // Wait before retrying
        continue;
      }
    }

    if (!hasValidSchema) {
      throw new Error("Deployment table schema is invalid");
    }

    // Clear any existing deployment data
    await this.databaseUtils.clearDeployments();

    // Wait for both bot instances to be healthy
    await this.dockerUtils.waitForContainersHealthy([
      "sushii_worker_blue_test",
      "sushii_worker_green_test",
    ]);

    // Wait for health check endpoints to be ready
    await this.healthCheckUtils.waitForAllBotsHealthy();

    this.logger.info("E2E test environment setup complete");

    return {
      dockerUtils: this.dockerUtils,
      databaseUtils: this.databaseUtils,
      healthCheckUtils: this.healthCheckUtils,
      logger: this.logger,
    };
  }

  /**
   * Cleanup e2e test environment
   */
  async cleanupTestEnvironment(): Promise<void> {
    try {
      // Stop Docker containers and clean up
      await this.dockerUtils.stopTestEnvironment();

      // Close database connection
      await this.databaseUtils.close();

      this.logger.info("E2E test environment cleanup complete");
    } catch (err) {
      this.logger.error({ err }, "Failed to cleanup test environment");
      throw err;
    }
  }

  /**
   * Initialize deployment to a known state for testing
   */
  async initializeDeploymentState(
    initialDeployment: "blue" | "green" = "blue",
  ): Promise<void> {
    // Set deployment to a known initial state using the webhook command
    await this.triggerDeploymentSwitchover(initialDeployment);
    this.logger.info({ initialDeployment }, "Deployment state initialized");
  }

  /**
   * Get current deployment state from database
   */
  async getCurrentDeploymentState(): Promise<{
    database: string | null;
  }> {
    const dbDeployment = await this.databaseUtils.getActiveDeployment();

    return {
      database: dbDeployment?.name || null,
    };
  }

  /**
   * Trigger deployment switchover by sending webhook message to Discord
   */
  async triggerDeploymentSwitchover(
    targetDeployment: "blue" | "green",
  ): Promise<void> {
    this.logger.info({ targetDeployment }, "Triggering deployment switchover");

    // Get E2E webhook URL from environment
    const webhookUrl = process.env.E2E_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error(
        "E2E_WEBHOOK_URL environment variable is required for webhook-based testing",
      );
    }

    // Send !set-deployment command via webhook
    await this.sendWebhookMessage(
      webhookUrl,
      `!set-deployment ${targetDeployment}`,
    );

    // Wait for command to be processed
    await sleep(2000);

    this.logger.info({ targetDeployment }, "Deployment switchover completed");
  }

  /**
   * Send a message via Discord webhook
   */
  private async sendWebhookMessage(
    webhookUrl: string,
    content: string,
  ): Promise<void> {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to send webhook message: ${response.status} ${errorText}`,
      );
    }

    this.logger.info({ content }, "Webhook message sent successfully");
  }

  /**
   * Get bot container logs for debugging
   */
  getBotLogs(deployment: "blue" | "green"): string {
    const containerName =
      deployment === "blue"
        ? "sushii_worker_blue_test"
        : "sushii_worker_green_test";

    return this.dockerUtils.getContainerLogs(containerName);
  }

  /**
   * Check if both bots are running
   */
  async areBotsRunning(): Promise<{ blue: boolean; green: boolean }> {
    const [blueRunning, greenRunning] = await Promise.all([
      this.dockerUtils.isContainerRunning("sushii_worker_blue_test"),
      this.dockerUtils.isContainerRunning("sushii_worker_green_test"),
    ]);

    return {
      blue: blueRunning,
      green: greenRunning,
    };
  }

  /**
   * Restart a bot instance
   */
  async restartBot(deployment: "blue" | "green"): Promise<void> {
    const containerName =
      deployment === "blue"
        ? "sushii_worker_blue_test"
        : "sushii_worker_green_test";

    await this.dockerUtils.restartContainer(containerName);

    // Wait for bot to be healthy after restart
    const port = deployment === "blue" ? 8081 : 8082;
    await this.healthCheckUtils.waitForBotHealthy(port);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
