import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { DrizzleMessageLogBlockRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogBlockRepository";
import { DrizzleMessageLogPostRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogPostRepository";
import type * as schema from "@/infrastructure/database/schema";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";

import { ProofSuggestionService } from "./application/ProofSuggestionService";
import { DiscordMessageExistenceChecker } from "./infrastructure/DiscordMessageExistenceChecker";
import { DrizzleProofSuggestionMessageRepository } from "./infrastructure/DrizzleProofSuggestionMessageRepository";

export function createProofSuggestionServices({
  db,
  client,
  logger,
}: {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
}) {
  const serviceLogger = logger.child({ module: "proofSuggestions" });

  const proofSuggestionService = new ProofSuggestionService({
    messages: new DrizzleProofSuggestionMessageRepository(db),
    logPosts: new DrizzleMessageLogPostRepository(db),
    logBlocks: new DrizzleMessageLogBlockRepository(db, serviceLogger),
    guildConfigs: new DrizzleGuildConfigRepository(db, serviceLogger),
    existence: new DiscordMessageExistenceChecker(client.rest, serviceLogger),
    logger: serviceLogger,
  });

  return { proofSuggestionService };
}
