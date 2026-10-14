import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { AuditReport } from "../domain/Finding";
import type { UsageSnapshot } from "../domain/GuildSnapshot";
import type { PermissionAuditReadRepository } from "../domain/PermissionAuditReadRepository";
import type { PermissionName } from "../domain/PermissionUsage";
import type { PermissionUsageCoverageRepository } from "../domain/PermissionUsageCoverageRepository";
import { analyzePermissions } from "../domain/analyzePermissions";
import { observedSince } from "../domain/observedSince";
import {
  DANGEROUS_PERMISSIONS,
  permissionsIn,
} from "../domain/permissionCatalog";
import type { AuditLogBackfillService } from "../infrastructure/AuditLogBackfillService";
import { buildGuildSnapshot } from "../infrastructure/buildGuildSnapshot";

export interface AuditContext {
  guildName: string;
  canViewAuditLog: boolean;
  /** Oldest point the report has usage history for, or null with no audit log access. */
  historyStart: Date | null;
  backfillPending: boolean;
  cachedMembers: number;
  totalMembers: number;
}

export interface AuditResult {
  report: AuditReport;
  context: AuditContext;
}

export class PermissionAuditService {
  constructor(
    private readonly readRepository: PermissionAuditReadRepository,
    private readonly coverageRepository: PermissionUsageCoverageRepository,
    private readonly backfillService: AuditLogBackfillService,
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

    const holderIds = this.dangerousRoleHolderIds(guild);
    const [usageRows, lastActiveAt, selfAssignable] = await Promise.all([
      this.readRepository.listUsage(guild.id),
      this.readRepository.lastActiveAt(guild.id, holderIds),
      this.readRepository.listSelfAssignableRoles(guild.id),
    ]);

    const lastUsed = new Map<string, Map<PermissionName, Date>>();
    for (const row of usageRows) {
      const perUser = lastUsed.get(row.userId) ?? new Map();
      const existing = perUser.get(row.permission);
      if (!existing || row.lastUsedAt > existing) {
        perUser.set(row.permission, row.lastUsedAt);
      }
      lastUsed.set(row.userId, perUser);
    }

    // Without the audit log, only message-based permissions have evidence.
    const observed = canViewAuditLog
      ? new Set([...this.auditLogPermissions, ...this.messagePermissions])
      : this.messagePermissions;
    const since = observedSince(observed, coverage, now);

    const usage: UsageSnapshot = {
      lastUsed,
      observedSince: since,
      backfillPending,
    };
    const snapshot = buildGuildSnapshot(
      guild,
      lastActiveAt,
      selfAssignable,
      now,
    );

    const historyStarts = [...since.values()];
    return {
      report: analyzePermissions(snapshot, usage),
      context: {
        guildName: guild.name,
        canViewAuditLog,
        historyStart:
          canViewAuditLog && historyStarts.length > 0
            ? new Date(Math.min(...historyStarts.map((d) => d.getTime())))
            : null,
        backfillPending,
        cachedMembers: guild.members.cache.size,
        totalMembers: guild.memberCount,
      },
    };
  }

  private dangerousRoleHolderIds(guild: Guild): string[] {
    const ids = new Set<string>();

    for (const role of guild.roles.cache.values()) {
      if (
        role.id === guild.id ||
        permissionsIn(role.permissions.bitfield, DANGEROUS_PERMISSIONS)
          .length === 0
      ) {
        continue;
      }

      for (const memberId of role.members.keys()) {
        ids.add(memberId);
      }
    }

    return [...ids];
  }
}
