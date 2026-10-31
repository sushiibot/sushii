import { and, desc, eq, ilike, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { serverNameHistoryInAppPublic } from "@/infrastructure/database/schema";

import type { ServerNameHistoryRepository } from "../domain/ServerNameHistory";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class DrizzleServerNameHistoryRepository
  implements ServerNameHistoryRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async record(guildId: string, names: string[]): Promise<void> {
    const unique = [...new Set(names)];
    if (unique.length === 0) {
      return;
    }

    await this.db
      .insert(serverNameHistoryInAppPublic)
      .values(unique.map((name) => ({ guildId: BigInt(guildId), name })))
      .onConflictDoUpdate({
        target: [
          serverNameHistoryInAppPublic.guildId,
          serverNameHistoryInAppPublic.name,
        ],
        set: { lastUsedAt: sql`now()` },
      });
  }

  async search(
    guildId: string,
    query: string,
    excludeName: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ name: serverNameHistoryInAppPublic.name })
      .from(serverNameHistoryInAppPublic)
      .where(
        and(
          eq(serverNameHistoryInAppPublic.guildId, BigInt(guildId)),
          ne(serverNameHistoryInAppPublic.name, excludeName),
          query
            ? ilike(serverNameHistoryInAppPublic.name, `%${escapeLike(query)}%`)
            : undefined,
        ),
      )
      .orderBy(desc(serverNameHistoryInAppPublic.lastUsedAt))
      .limit(limit);

    return rows.map((r) => r.name);
  }
}
