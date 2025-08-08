import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { Deployment } from "@/features/deployment/domain/entities/Deployment";
import { setupModerationFeature } from "@/features/moderation/setup";
import { setupGiveawayFeature } from "@/features/giveaways/setup";
import { createLevelingServices } from "@/features/leveling/setup";
import type * as schema from "@/infrastructure/database/schema";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";
import type { DeploymentConfig } from "@/shared/infrastructure/config/config";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type {
  MockDiscordClient} from "./mockDiscordClient";
import {
  createMockDiscordClient,
} from "./mockDiscordClient";

export interface IntegrationTestServices {
  db: NodePgDatabase<typeof schema>;
  mockDiscord: MockDiscordClient;
  moderationFeature: ReturnType<typeof setupModerationFeature>;
  giveawayFeature: ReturnType<typeof setupGiveawayFeature>;
  guildConfigRepository: DrizzleGuildConfigRepository;
  deploymentService: DeploymentService;
  logger: pino.Logger;
  postgresTest: PostgresTestDatabase;
}

/**
 * Sets up a complete integration test environment with real services
 * and a mocked Discord client.
 */
export async function setupIntegrationTest(): Promise<IntegrationTestServices> {
  const logger = pino({ level: "debug" });

  // Setup test database
  const postgresTest = new PostgresTestDatabase();
  const db = await postgresTest.initialize();

  // Create mock Discord client
  const mockDiscord = createMockDiscordClient();

  // For tests, we'll use a simple in-memory deployment service
  // since PostgreSQLDeploymentRepository requires special setup
  const testDeployment = Deployment.create("blue");
  const mockDeploymentRepo = {
    getActive: async () => testDeployment,
    setActive: async () => Promise.resolve(),
    start: async () => Promise.resolve(),
    stop: async () => Promise.resolve(),
  };

  const deploymentConfig = {
    name: "blue" as const,
    primaryChannelId: null,
  };

  const deploymentService = new DeploymentService(
    mockDeploymentRepo,
    logger,
    "blue" as const,
    deploymentConfig as unknown as DeploymentConfig,
  );

  // Start the deployment service
  await deploymentService.start();

  // Create guild config repository (shared service)
  const guildConfigRepository = new DrizzleGuildConfigRepository(db, logger);

  // Create leveling services (needed for giveaways)
  const levelingServices = createLevelingServices({ db, logger });

  // Create moderation services with mock client
  const moderationFeature = setupModerationFeature({
    db,
    client: mockDiscord.client as unknown as Client,
    logger,
    deploymentService,
  });

  // Create giveaway services with mock client
  const giveawayFeature = setupGiveawayFeature({
    db,
    userLevelRepository: levelingServices.userLevelRepository,
    logger,
    client: mockDiscord.client as unknown as Client,
    deploymentService,
  });

  return {
    db,
    mockDiscord,
    moderationFeature,
    giveawayFeature,
    guildConfigRepository,
    deploymentService,
    logger,
    postgresTest,
  };
}

/**
 * Cleans up test resources
 */
export async function cleanupIntegrationTest(
  services: IntegrationTestServices,
): Promise<void> {
  // Close database connection and stop container
  await services.postgresTest.close();
}
