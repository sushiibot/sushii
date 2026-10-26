import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import { guildFeatureFlagsInAppPublic } from "@/infrastructure/database/schema";

import type { FeatureFlag, FeatureFlagEntry } from "../domain/FeatureFlag";
import type { FeatureFlagRepository } from "../domain/FeatureFlagRepository";

const SNAPSHOT_TTL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 5_000;

type FeatureFlagRow = typeof guildFeatureFlagsInAppPublic.$inferSelect;

function toEntry(row: FeatureFlagRow): FeatureFlagEntry {
  return {
    guildId: row.guildId.toString(),
    flag: row.flag,
    enabledBy: row.enabledBy.toString(),
    enabledAt: row.enabledAt,
  };
}

function snapshotKey(guildId: string, flag: FeatureFlag): string {
  return `${flag}:${guildId}`;
}

export class DrizzleFeatureFlagRepository implements FeatureFlagRepository {
  private snapshot: Set<string> | null = null;
  private nextRefreshAt = 0;
  private lastLoadError: unknown = null;
  private inflight: Promise<Set<string>> | null = null;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async isEnabled(guildId: string, flag: FeatureFlag): Promise<boolean> {
    const snapshot = await this.getSnapshot();
    return snapshot.has(snapshotKey(guildId, flag));
  }

  async listGuilds(flag: FeatureFlag): Promise<FeatureFlagEntry[]> {
    const rows = await this.db
      .select()
      .from(guildFeatureFlagsInAppPublic)
      .where(eq(guildFeatureFlagsInAppPublic.flag, flag))
      .orderBy(guildFeatureFlagsInAppPublic.enabledAt);

    return rows.map(toEntry);
  }

  async listAll(): Promise<FeatureFlagEntry[]> {
    const rows = await this.db.select().from(guildFeatureFlagsInAppPublic);
    return rows.map(toEntry);
  }

  async enable(
    guildId: string,
    flag: FeatureFlag,
    enabledBy: string,
  ): Promise<void> {
    // Keeps the original enabler and time when the flag is already on.
    await this.db
      .insert(guildFeatureFlagsInAppPublic)
      .values({
        guildId: BigInt(guildId),
        flag,
        enabledBy: BigInt(enabledBy),
        enabledAt: new Date(this.now()),
      })
      .onConflictDoNothing();

    await this.refreshAfterWrite((snapshot) =>
      snapshot.add(snapshotKey(guildId, flag)),
    );
  }

  async disable(guildId: string, flag: FeatureFlag): Promise<boolean> {
    const rows = await this.db
      .delete(guildFeatureFlagsInAppPublic)
      .where(
        and(
          eq(guildFeatureFlagsInAppPublic.guildId, BigInt(guildId)),
          eq(guildFeatureFlagsInAppPublic.flag, flag),
        ),
      )
      .returning({ guildId: guildFeatureFlagsInAppPublic.guildId });

    await this.refreshAfterWrite((snapshot) =>
      snapshot.delete(snapshotKey(guildId, flag)),
    );

    return rows.length > 0;
  }

  private async getSnapshot(): Promise<Set<string>> {
    if (this.snapshot && this.now() < this.nextRefreshAt) {
      return this.snapshot;
    }

    if (this.lastLoadError && this.now() < this.nextRefreshAt) {
      throw this.lastLoadError;
    }

    return this.inflight ?? this.load();
  }

  private async refreshAfterWrite(
    apply: (snapshot: Set<string>) => void,
  ): Promise<void> {
    // A load already in flight may have read rows from before this write.
    if (this.inflight) {
      await this.inflight.catch(() => undefined);
    }

    if (this.snapshot) {
      apply(this.snapshot);
    }

    try {
      await this.load();
    } catch (err) {
      this.logger.warn({ err }, "Failed to refresh feature flag snapshot");
    }
  }

  private load(): Promise<Set<string>> {
    const promise = this.listAll()
      .then((entries) => {
        this.snapshot = new Set(
          entries.map((e) => snapshotKey(e.guildId, e.flag)),
        );
        this.nextRefreshAt = this.now() + SNAPSHOT_TTL_MS;
        this.lastLoadError = null;
        return this.snapshot;
      })
      .catch((err: unknown) => {
        this.nextRefreshAt = this.now() + RETRY_AFTER_FAILURE_MS;

        if (!this.snapshot) {
          this.lastLoadError = err;
          throw err;
        }

        this.logger.warn(
          { err },
          "Failed to refresh feature flag snapshot, serving last snapshot",
        );
        return this.snapshot;
      })
      .finally(() => {
        if (this.inflight === promise) {
          this.inflight = null;
        }
      });

    this.inflight = promise;
    return promise;
  }
}
