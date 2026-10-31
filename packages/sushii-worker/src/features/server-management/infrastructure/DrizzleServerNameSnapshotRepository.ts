import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { serverNameSnapshotsInAppPublic } from "@/infrastructure/database/schema";

import type {
  ServerNameSnapshot,
  ServerNameSnapshotRepository,
} from "../domain/ServerNameSnapshot";

export class DrizzleServerNameSnapshotRepository
  implements ServerNameSnapshotRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findByGuild(guildId: string): Promise<ServerNameSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(serverNameSnapshotsInAppPublic)
      .where(eq(serverNameSnapshotsInAppPublic.guildId, BigInt(guildId)));

    if (!row) {
      return null;
    }

    return {
      guildId: row.guildId.toString(),
      name: row.name,
      savedBy: row.savedBy.toString(),
      savedAt: row.savedAt,
    };
  }

  async saveIfAbsent(
    snapshot: Omit<ServerNameSnapshot, "savedAt">,
  ): Promise<void> {
    await this.db
      .insert(serverNameSnapshotsInAppPublic)
      .values({
        guildId: BigInt(snapshot.guildId),
        name: snapshot.name,
        savedBy: BigInt(snapshot.savedBy),
      })
      .onConflictDoNothing();
  }

  async deleteByGuild(guildId: string): Promise<void> {
    await this.db
      .delete(serverNameSnapshotsInAppPublic)
      .where(eq(serverNameSnapshotsInAppPublic.guildId, BigInt(guildId)));
  }
}
