import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import { screeningGuildsInAppPublic } from "@/infrastructure/database/schema";

import type { ScreeningGuildRepository } from "../domain/repositories/ScreeningGuildRepository";
import type { ScreeningGuildSettings } from "../domain/types";

const SNAPSHOT_TTL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 5_000;

type ScreeningGuildRow = typeof screeningGuildsInAppPublic.$inferSelect;

function toSettings(row: ScreeningGuildRow): ScreeningGuildSettings {
  return {
    guildId: row.guildId.toString(),
    logChannelId: row.logChannelId?.toString() ?? null,
    maxMessages: row.maxMessages,
    windowHours: row.windowHours,
    reviewThreshold: row.reviewThreshold,
    rules: row.rules ?? null,
    checkAvatars: row.checkAvatars,
    dailyCheckCap: row.dailyCheckCap,
    enabledBy: row.enabledBy.toString(),
    enabledAt: row.enabledAt,
  };
}

export class DrizzleScreeningGuildRepository
  implements ScreeningGuildRepository
{
  private snapshot: Map<string, ScreeningGuildSettings> | null = null;
  private nextRefreshAt = 0;
  private lastLoadError: unknown = null;
  private inflight: Promise<Map<string, ScreeningGuildSettings>> | null = null;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async findByGuildId(guildId: string): Promise<ScreeningGuildSettings | null> {
    const snapshot = await this.getSnapshot();
    return snapshot.get(guildId) ?? null;
  }

  async list(): Promise<ScreeningGuildSettings[]> {
    const rows = await this.db
      .select()
      .from(screeningGuildsInAppPublic)
      .orderBy(screeningGuildsInAppPublic.enabledAt);

    return rows.map(toSettings);
  }

  async upsert(
    settings: ScreeningGuildSettings,
  ): Promise<ScreeningGuildSettings> {
    const values = {
      guildId: BigInt(settings.guildId),
      logChannelId: settings.logChannelId
        ? BigInt(settings.logChannelId)
        : null,
      maxMessages: settings.maxMessages,
      windowHours: settings.windowHours,
      reviewThreshold: settings.reviewThreshold,
      rules: settings.rules,
      checkAvatars: settings.checkAvatars,
      dailyCheckCap: settings.dailyCheckCap,
      enabledBy: BigInt(settings.enabledBy),
      enabledAt: settings.enabledAt,
    };

    const [row] = await this.db
      .insert(screeningGuildsInAppPublic)
      .values(values)
      .onConflictDoUpdate({
        target: screeningGuildsInAppPublic.guildId,
        set: values,
      })
      .returning();

    const saved = toSettings(row);
    await this.refreshAfterWrite((snapshot) =>
      snapshot.set(saved.guildId, saved),
    );

    return saved;
  }

  async delete(guildId: string): Promise<boolean> {
    const rows = await this.db
      .delete(screeningGuildsInAppPublic)
      .where(eq(screeningGuildsInAppPublic.guildId, BigInt(guildId)))
      .returning({ guildId: screeningGuildsInAppPublic.guildId });

    await this.refreshAfterWrite((snapshot) => snapshot.delete(guildId));

    return rows.length > 0;
  }

  private async getSnapshot(): Promise<Map<string, ScreeningGuildSettings>> {
    if (this.snapshot && this.now() < this.nextRefreshAt) {
      return this.snapshot;
    }

    if (this.lastLoadError && this.now() < this.nextRefreshAt) {
      throw this.lastLoadError;
    }

    return this.inflight ?? this.load();
  }

  private async refreshAfterWrite(
    apply: (snapshot: Map<string, ScreeningGuildSettings>) => void,
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
      this.logger.warn({ err }, "Failed to refresh screening guild snapshot");
    }
  }

  private load(): Promise<Map<string, ScreeningGuildSettings>> {
    const promise = this.list()
      .then((settings) => {
        this.snapshot = new Map(settings.map((s) => [s.guildId, s]));
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
          "Failed to refresh screening guild snapshot, serving last snapshot",
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
