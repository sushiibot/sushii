import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { DrizzleStatusRepository } from "./infrastructure/DrizzleStatusRepository";
import StatusCommand from "./presentation/StatusCommand";

interface StatusFeatureServices {
  statusRepository: DrizzleStatusRepository;
}

interface SetupParams {
  db: NodePgDatabase<typeof schema>;
}

export function setupStatusFeature({
  db,
}: SetupParams): FullFeatureSetupReturn<StatusFeatureServices> {
  const statusRepository = new DrizzleStatusRepository(db);
  const statusCommand = new StatusCommand(statusRepository);

  return {
    services: {
      statusRepository,
    },
    commands: [statusCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [],
  };
}
