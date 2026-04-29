import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import type { GuildChangelogPromptData } from "../domain/GuildChangelogPrompt";
import type { ChangelogPromptRepository } from "../domain/repositories/ChangelogPromptRepository";

type DbType = NodePgDatabase<typeof schema>;

export class DrizzleChangelogPromptRepository implements ChangelogPromptRepository {
  constructor(private readonly db: DbType) {}

  async findByGuildId(guildId: bigint): Promise<GuildChangelogPromptData | null> {
    const results = await this.db
      .select()
      .from(schema.guildChangelogPromptsInAppPublic)
      .where(eq(schema.guildChangelogPromptsInAppPublic.guildId, guildId))
      .limit(1);
    return results[0] ?? null;
  }

  async upsert(data: GuildChangelogPromptData): Promise<void> {
    await this.db
      .insert(schema.guildChangelogPromptsInAppPublic)
      .values(data)
      .onConflictDoUpdate({
        target: schema.guildChangelogPromptsInAppPublic.guildId,
        set: {
          lastPromptedAt: data.lastPromptedAt,
          snoozeUntil: data.snoozeUntil,
          dismissedAt: data.dismissedAt,
          followedAt: data.followedAt,
        },
      });
  }
}
