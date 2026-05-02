import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import { UserNameHistoryService } from "./application";
import { DrizzleUserNameHistoryRepository } from "./infrastructure";
import { UserNameHistoryGuildMemberUpdateHandler } from "./presentation";

interface UserNameHistoryFeatureDependencies {
  db: NodePgDatabase<typeof schema>;
}

export interface UserNameHistoryFeature {
  service: UserNameHistoryService;
  eventHandlers: [UserNameHistoryGuildMemberUpdateHandler];
}

export function setupUserNameHistoryFeature(
  dependencies: UserNameHistoryFeatureDependencies,
): UserNameHistoryFeature {
  const repo = new DrizzleUserNameHistoryRepository(dependencies.db);
  const service = new UserNameHistoryService(repo);

  return {
    service,
    eventHandlers: [new UserNameHistoryGuildMemberUpdateHandler(service)],
  };
}
