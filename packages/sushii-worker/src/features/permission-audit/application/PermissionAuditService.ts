import type { Guild, GuildMember } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { AuditReport } from "../domain/Finding";
import type { GuildSnapshot, UsageSnapshot } from "../domain/GuildSnapshot";
import type {
  PermissionAuditReadRepository,
  UsageRow,
} from "../domain/PermissionAuditReadRepository";
import type { PermissionName } from "../domain/PermissionUsage";
import type { PermissionUsageCoverageRepository } from "../domain/PermissionUsageCoverageRepository";
import { analyzePermissions } from "../domain/analyzePermissions";
import { AUDIT_WINDOW_DAYS } from "../domain/analyzePermissions";
import { observedSince } from "../domain/observedSince";
import type { AuditLogBackfillService } from "../infrastructure/AuditLogBackfillService";
import { buildGuildSnapshot } from "../infrastructure/buildGuildSnapshot";

export interface AuditContext {
  guildName: string;
  canViewAuditLog: boolean;
  /** Oldest point the report has usage history for, or null with no audit log access. */
  historyStart: Date | null;
  backfillPending: boolean;
}

export interface AuditResult {
  report: AuditReport;
  context: AuditContext;
  snapshot: GuildSnapshot;
}

export interface ResolvedMembers {
  members: ReadonlyMap<string, GuildMember>;
  /** Asked for but not fetched; requested members missing from `members` left the guild. */
  unresolvedIds: ReadonlySet<string>;
}

/** Never the full member list: exact counts, plus the few members the report needs. */
export interface AuditMemberSource {
  roleMemberCounts(guild: Guild): Promise<Map<string, number>>;
  membersById(
    guild: Guild,
    userIds: readonly string[],
  ): Promise<ResolvedMembers>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class PermissionAuditService {
  constructor(
    private readonly readRepository: PermissionAuditReadRepository,
    private readonly coverageRepository: PermissionUsageCoverageRepository,
    private readonly backfillService: AuditLogBackfillService,
    private readonly memberSource: AuditMemberSource,
    private readonly auditLogPermissions: ReadonlySet<PermissionName>,
    private readonly messagePermissions: ReadonlySet<PermissionName>,
  ) {}

  async generate(guild: Guild): Promise<AuditResult> {
    const now = new Date();
    const canViewAuditLog =
      guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog) ??
      false;

    const coverage = await this.coverageRepository.get(guild.id);
    const backfillPending = canViewAuditLog && !coverage?.backfilledAt;
    if (backfillPending) {
      this.backfillService.startIfNeeded(guild);
    }

    const [usageRows, selfAssignable, holderCounts] = await Promise.all([
      this.readRepository.listUsage(guild.id),
      this.readRepository.listSelfAssignableRoles(guild.id),
      this.memberSource.roleMemberCounts(guild),
    ]);

    const windowStart = new Date(now.getTime() - AUDIT_WINDOW_DAYS * DAY_MS);
    const recentUsers = usersByRecentUse(usageRows, windowStart);
    const botIds = guild.roles.cache
      .map((role) => role.tags?.botId)
      .filter((id): id is string => id != null);
    // Bots first: they decide which roles get no automatic fix, while an
    // unfetched user's usage already counts as used.
    const { members, unresolvedIds } = await this.memberSource.membersById(
      guild,
      [...new Set([...botIds, ...recentUsers])],
    );
    const unresolved = new Set(
      usageRows
        .filter(
          (row) =>
            row.lastUsedAt >= windowStart && unresolvedIds.has(row.userId),
        )
        .map((row) => row.permission),
    );

    const lastUsed = latestByUser(usageRows);
    const auditLogLastUsed = latestByUser(
      usageRows.filter((row) => row.source === "audit_log"),
    );

    // Without the audit log, only message-based permissions have evidence.
    const observed = canViewAuditLog
      ? new Set([...this.auditLogPermissions, ...this.messagePermissions])
      : this.messagePermissions;
    const since = observedSince(observed, coverage, now);

    const usage: UsageSnapshot = {
      lastUsed,
      auditLogLastUsed,
      observedSince: since,
      unresolved,
      backfillPending,
    };
    const snapshot = buildGuildSnapshot(
      guild,
      members,
      holderCounts,
      selfAssignable,
      now,
    );

    const historyStarts = [...since.values()];
    return {
      snapshot,
      report: analyzePermissions(snapshot, usage),
      context: {
        guildName: guild.name,
        canViewAuditLog,
        historyStart:
          canViewAuditLog && historyStarts.length > 0
            ? new Date(Math.min(...historyStarts.map((d) => d.getTime())))
            : null,
        backfillPending,
      },
    };
  }
}

function latestByUser(
  rows: readonly UsageRow[],
): Map<string, Map<PermissionName, Date>> {
  const result = new Map<string, Map<PermissionName, Date>>();

  for (const row of rows) {
    const perUser = result.get(row.userId) ?? new Map<PermissionName, Date>();
    const existing = perUser.get(row.permission);
    if (!existing || row.lastUsedAt > existing) {
      perUser.set(row.permission, row.lastUsedAt);
    }
    result.set(row.userId, perUser);
  }

  return result;
}

/** Most recent first, so a capped fetch keeps the users whose evidence is freshest. */
function usersByRecentUse(rows: readonly UsageRow[], since: Date): string[] {
  const latest = new Map<string, number>();
  for (const row of rows) {
    if (row.lastUsedAt < since) {
      continue;
    }
    latest.set(
      row.userId,
      Math.max(latest.get(row.userId) ?? 0, row.lastUsedAt.getTime()),
    );
  }
  return [...latest.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([userId]) => userId);
}
