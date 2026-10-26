import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";

import type { FeatureFlagRepository } from "./domain/FeatureFlagRepository";
import { DrizzleFeatureFlagRepository } from "./infrastructure/DrizzleFeatureFlagRepository";
import type { ScreeningStateReader } from "./presentation/FeatureFlagCommand";
import { FeatureFlagCommand } from "./presentation/FeatureFlagCommand";

/** Build once per cluster and share: writes refresh this instance's snapshot at once, other clusters pick them up within a minute. */
export function createFeatureFlagRepository(
  db: NodePgDatabase<typeof schema>,
  logger: Logger,
): FeatureFlagRepository {
  return new DrizzleFeatureFlagRepository(
    db,
    logger.child({ component: "FeatureFlagRepository" }),
  );
}

export function createFeatureFlagCommands({
  repository,
  screening,
  ownerUserId,
  logger,
}: {
  repository: FeatureFlagRepository;
  screening: ScreeningStateReader | null;
  ownerUserId: string | undefined;
  logger: Logger;
}) {
  return [
    new FeatureFlagCommand(
      repository,
      screening,
      ownerUserId,
      logger.child({ commandHandler: "feature-flag" }),
    ),
  ];
}
