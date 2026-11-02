import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  ipGrabberDomainsInAppPublic as domains,
  ipGrabberGuildSettingsInAppPublic as guildSettings,
} from "@/infrastructure/database/schema";

import type {
  IpGrabberDomain,
  IpGrabberGuildSettings,
  IpGrabberRepository,
  IpGrabberSyncError,
  NewIpGrabberDomain,
} from "../domain/IpGrabberRepository";
import {
  type IpGrabberProviderId,
  isIpGrabberProviderId,
} from "../domain/providers";

type SettingsRow = typeof guildSettings.$inferSelect;
type DomainRow = typeof domains.$inferSelect;

const SYNC_ERRORS: readonly string[] = [
  "rule_missing",
  "rule_full",
  "missing_permission",
] satisfies IpGrabberSyncError[];

function toSettings(row: SettingsRow): IpGrabberGuildSettings {
  return {
    guildId: row.guildId.toString(),
    ruleId: row.ruleId?.toString() ?? null,
    ruleName: row.ruleName,
    providers: row.providers.filter(isIpGrabberProviderId),
    managedKeywords: row.managedKeywords,
    lastSyncedAt: row.lastSyncedAt,
    lastError:
      row.lastError && SYNC_ERRORS.includes(row.lastError)
        ? (row.lastError as IpGrabberSyncError)
        : null,
  };
}

function toDomain(row: DomainRow): IpGrabberDomain | null {
  if (!isIpGrabberProviderId(row.provider)) {
    return null;
  }

  return {
    hostname: row.hostname,
    provider: row.provider,
    source: row.source === "endpoint" ? "endpoint" : "discovered",
    status: row.status,
    firstSeenGuildId: row.firstSeenGuildId,
    firstSeenGuildName: row.firstSeenGuildName,
    firstSeenChannelId: row.firstSeenChannelId,
    firstSeenChannelName: row.firstSeenChannelName,
    reviewStatus: row.reviewStatus,
    reviewMessageId: row.reviewMessageId,
    failedChecks: row.failedChecks,
    createdAt: row.createdAt,
  };
}

function toDomains(rows: DomainRow[]): IpGrabberDomain[] {
  return rows.flatMap((row) => toDomain(row) ?? []);
}

export class DrizzleIpGrabberRepository implements IpGrabberRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getSettings(guildId: string): Promise<IpGrabberGuildSettings | null> {
    const [row] = await this.db
      .select()
      .from(guildSettings)
      .where(eq(guildSettings.guildId, BigInt(guildId)));

    return row ? toSettings(row) : null;
  }

  async listConfiguredSettings(): Promise<IpGrabberGuildSettings[]> {
    const rows = await this.db
      .select()
      .from(guildSettings)
      .where(isNotNull(guildSettings.ruleId));

    return rows.map(toSettings);
  }

  async saveSettings(settings: IpGrabberGuildSettings): Promise<void> {
    const values = {
      ruleId: settings.ruleId ? BigInt(settings.ruleId) : null,
      ruleName: settings.ruleName,
      providers: settings.providers,
      managedKeywords: settings.managedKeywords,
      lastSyncedAt: settings.lastSyncedAt,
      lastError: settings.lastError,
    };

    await this.db
      .insert(guildSettings)
      .values({ guildId: BigInt(settings.guildId), ...values })
      .onConflictDoUpdate({ target: guildSettings.guildId, set: values });
  }

  async listActiveHostnames(): Promise<Map<IpGrabberProviderId, string[]>> {
    const rows = await this.db
      .select({ hostname: domains.hostname, provider: domains.provider })
      .from(domains)
      .where(eq(domains.status, "active"));

    const byProvider = new Map<IpGrabberProviderId, string[]>();
    for (const row of rows) {
      if (!isIpGrabberProviderId(row.provider)) {
        continue;
      }
      const list = byProvider.get(row.provider) ?? [];
      list.push(row.hostname);
      byProvider.set(row.provider, list);
    }

    return byProvider;
  }

  async listRevertedHostnames(): Promise<Set<string>> {
    const rows = await this.db
      .select({ hostname: domains.hostname })
      .from(domains)
      .where(eq(domains.status, "reverted"));

    return new Set(rows.map((row) => row.hostname));
  }

  async listDomainsToRecheck(): Promise<IpGrabberDomain[]> {
    const rows = await this.db
      .select()
      .from(domains)
      .where(eq(domains.status, "active"));

    return toDomains(rows);
  }

  async findDomain(hostname: string): Promise<IpGrabberDomain | null> {
    const [row] = await this.db
      .select()
      .from(domains)
      .where(eq(domains.hostname, hostname));

    return row ? toDomain(row) : null;
  }

  async addDomain(domain: NewIpGrabberDomain): Promise<boolean> {
    const inserted = await this.db
      .insert(domains)
      .values({
        hostname: domain.hostname,
        provider: domain.provider,
        source: domain.source,
        firstSeenGuildId: domain.firstSeenGuildId,
        firstSeenGuildName: domain.firstSeenGuildName,
        firstSeenChannelId: domain.firstSeenChannelId,
        firstSeenChannelName: domain.firstSeenChannelName,
      })
      .onConflictDoUpdate({
        target: domains.hostname,
        set: {
          status: "active",
          failedChecks: 0,
          lastCheckedAt: sql`now()`,
        },
        setWhere: eq(domains.status, "stale"),
      })
      .returning({ hostname: domains.hostname });

    return inserted.length > 0;
  }

  async recordCheck(
    hostname: string,
    passed: boolean,
    staleAfter: number,
  ): Promise<void> {
    await this.db
      .update(domains)
      .set(
        passed
          ? { failedChecks: 0, lastCheckedAt: sql`now()` }
          : {
              failedChecks: sql`${domains.failedChecks} + 1`,
              lastCheckedAt: sql`now()`,
              status: sql`CASE WHEN ${domains.failedChecks} + 1 >= ${staleAfter} THEN 'stale'::app_public.ip_grabber_domain_status ELSE ${domains.status} END`,
            },
      )
      .where(and(eq(domains.hostname, hostname), eq(domains.status, "active")));
  }

  async listPendingReviews(): Promise<IpGrabberDomain[]> {
    const rows = await this.db
      .select()
      .from(domains)
      .where(eq(domains.reviewStatus, "pending"));

    return toDomains(rows);
  }

  async markReviewPosted(hostname: string, messageId: string): Promise<void> {
    await this.db
      .update(domains)
      .set({ reviewStatus: "posted", reviewMessageId: messageId })
      .where(
        and(
          eq(domains.hostname, hostname),
          eq(domains.reviewStatus, "pending"),
        ),
      );
  }

  async revert(hostname: string): Promise<boolean> {
    const updated = await this.db
      .update(domains)
      .set({ reviewStatus: "reverted", status: "reverted" })
      .where(
        and(eq(domains.hostname, hostname), eq(domains.reviewStatus, "posted")),
      )
      .returning({ hostname: domains.hostname });

    return updated.length > 0;
  }
}
