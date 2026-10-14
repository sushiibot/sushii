import type {
  AuditReport,
  AuditTab,
  BotRoleSummary,
  Finding,
  MemberInsight,
  RatedFinding,
} from "./Finding";
import type {
  GuildSnapshot,
  MemberSnapshot,
  RoleSnapshot,
  UsageSnapshot,
} from "./GuildSnapshot";
import type { PermissionName } from "./PermissionUsage";
import {
  DANGEROUS_PERMISSIONS,
  MFA_GATED_PERMISSIONS,
  type Severity,
  compareSeverity,
  hasPermission,
  highestSeverity,
  permissionsIn,
  severityOf,
} from "./permissionCatalog";

const DAY_MS = 24 * 60 * 60 * 1000;
export const AUDIT_WINDOW_DAYS = 45;
export const MIN_CONFIDENCE_DAYS = 14;

const CONCENTRATION_PERMISSIONS: readonly PermissionName[] = [
  "Administrator",
  "ManageRoles",
  "BanMembers",
];

export function analyzePermissions(
  guild: GuildSnapshot,
  usage: UsageSnapshot,
): AuditReport {
  const context = new AnalysisContext(guild, usage);
  const findings: RatedFinding[] = [];
  const bots: BotRoleSummary[] = [];
  const notTracked: AuditReport["notTracked"] = [];

  const everyone = guild.roles.find((r) => r.id === guild.everyoneRoleId);
  if (everyone) {
    const permissions = permissionsIn(
      everyone.permissions,
      DANGEROUS_PERMISSIONS,
    );
    if (permissions.length > 0) {
      findings.push(
        rate(
          { type: "everyone_dangerous", roleId: everyone.id, permissions },
          highestSeverity(permissions),
        ),
      );
    }
  }

  for (const role of context.rolesWithDangerousPermissions()) {
    if (role.botUserId) {
      bots.push(context.botSummary(role, role.botUserId));
      if (hasPermission(role.permissions, "Administrator")) {
        findings.push(
          rate(
            {
              type: "administrator_grant",
              roleId: role.id,
              holderCount: role.holderIds.length,
              usedPermissions: context.permissionsUsedBy(role.holderIds),
              isBotRole: true,
              lowConfidence: false,
              actionableAt: null,
            },
            "critical",
          ),
        );
      }
      continue;
    }

    if (hasPermission(role.permissions, "Administrator")) {
      findings.push(
        rate(
          {
            type: "administrator_grant",
            roleId: role.id,
            holderCount: role.holderIds.length,
            usedPermissions: context.permissionsUsedBy(role.holderIds),
            isBotRole: false,
            ...context.administratorConfidence(role),
          },
          "critical",
        ),
      );
      continue;
    }

    const roleResult = context.analyzeRoleUsage(role);
    findings.push(...roleResult.findings);
    if (roleResult.notTracked.length > 0) {
      notTracked.push({ roleId: role.id, permissions: roleResult.notTracked });
    }
  }

  findings.push(
    ...context.selfAssignableFindings(),
    ...context.escalationFindings(),
    ...context.overwriteFindings(),
    ...context.mfaFindings(),
  );

  findings.sort((a, b) => compareSeverity(a.severity, b.severity));

  return {
    findings,
    bots,
    members: context.memberInsights(),
    notTracked,
    holderCounts: context.holderCounts(),
  };
}

const TAB_BY_TYPE: Record<Finding["type"], AuditTab> = {
  everyone_dangerous: "roles",
  administrator_grant: "roles",
  partially_used_role: "roles",
  inactive_holders: "roles",
  self_assignable_role: "roles",
  escalation: "roles",
  mfa_disabled: "roles",
  unused_role_permission: "unused",
  possibly_used_through_bots: "unused",
  dangerous_overwrite: "channels",
  dead_overwrite: "channels",
};

function rate(finding: Finding, severity: Severity): RatedFinding {
  return { finding, severity, tab: TAB_BY_TYPE[finding.type] };
}

class AnalysisContext {
  private readonly windowStart: Date;
  private readonly rolesById: Map<string, RoleSnapshot>;
  /** Permissions some bot used: humans may be using them through that bot. */
  private readonly botExecuted: Set<PermissionName>;

  constructor(
    private readonly guild: GuildSnapshot,
    private readonly usage: UsageSnapshot,
  ) {
    this.windowStart = new Date(
      guild.now.getTime() - AUDIT_WINDOW_DAYS * DAY_MS,
    );
    this.rolesById = new Map(guild.roles.map((role) => [role.id, role]));
    this.botExecuted = new Set(
      [...usage.auditLogLastUsed.entries()]
        .filter(([userId]) => guild.members.get(userId)?.isBot)
        .flatMap(([, permissions]) =>
          [...permissions.entries()]
            .filter(([, lastUsed]) => lastUsed >= this.windowStart)
            .map(([permission]) => permission),
        ),
    );
  }

  rolesWithDangerousPermissions(): RoleSnapshot[] {
    return this.guild.roles.filter(
      (role) =>
        role.id !== this.guild.everyoneRoleId &&
        permissionsIn(role.permissions, DANGEROUS_PERMISSIONS).length > 0,
    );
  }

  botSummary(role: RoleSnapshot, botUserId: string): BotRoleSummary {
    const joinedAt = this.guild.members.get(botUserId)?.joinedAt;
    return {
      roleId: role.id,
      botUserId,
      permissions: permissionsIn(role.permissions, DANGEROUS_PERMISSIONS),
      addedRecently: joinedAt != null && joinedAt >= this.windowStart,
    };
  }

  permissionsUsedBy(userIds: readonly string[]): PermissionName[] {
    return DANGEROUS_PERMISSIONS.filter((permission) =>
      userIds.some((userId) => this.usedInWindow(userId, permission)),
    );
  }

  /**
   * Replacing Administrator removes everything not seen in use, so it needs
   * the same history as an unused finding, across every dangerous permission.
   */
  administratorConfidence(role: RoleSnapshot): {
    lowConfidence: boolean;
    actionableAt: Date | null;
  } {
    const starts = DANGEROUS_PERMISSIONS.map((p) =>
      this.usage.observedSince.get(p),
    ).filter((date): date is Date => date !== undefined);

    if (starts.length === 0) {
      return { lowConfidence: true, actionableAt: null };
    }

    const observedFrom = this.latest([
      role.createdAt,
      new Date(Math.min(...starts.map((date) => date.getTime()))),
    ]);
    const actionableAt = new Date(
      observedFrom.getTime() + MIN_CONFIDENCE_DAYS * DAY_MS,
    );

    return actionableAt > this.guild.now
      ? { lowConfidence: true, actionableAt }
      : { lowConfidence: false, actionableAt: null };
  }

  analyzeRoleUsage(role: RoleSnapshot): {
    findings: RatedFinding[];
    notTracked: PermissionName[];
  } {
    const findings: RatedFinding[] = [];
    const notTracked: PermissionName[] = [];
    const unused: PermissionName[] = [];
    const viaBots: PermissionName[] = [];
    const humans = this.humans(role.holderIds);

    if (humans.length === 0) {
      return { findings, notTracked };
    }

    const settled = humans.filter(
      (member) =>
        member.joinedAt == null ||
        this.guild.now.getTime() - member.joinedAt.getTime() >=
          MIN_CONFIDENCE_DAYS * DAY_MS,
    );
    const active = settled.filter(
      (member) =>
        member.lastActiveAt != null && member.lastActiveAt >= this.windowStart,
    );

    for (const permission of permissionsIn(
      role.permissions,
      DANGEROUS_PERMISSIONS,
    )) {
      if (!this.usage.observedSince.has(permission)) {
        notTracked.push(permission);
        continue;
      }

      const usedBy = humans.filter((member) =>
        this.usedInWindow(member.id, permission),
      );

      if (usedBy.length === 0) {
        (this.botExecuted.has(permission) ? viaBots : unused).push(permission);
        continue;
      }

      const mostlyActive = active.length * 2 >= settled.length;
      if (mostlyActive && usedBy.length < active.length) {
        findings.push(
          rate(
            {
              type: "partially_used_role",
              roleId: role.id,
              permission,
              holderCount: humans.length,
              activeCount: active.length,
              usedByIds: usedBy.map((member) => member.id),
            },
            severityOf(permission),
          ),
        );
      }
    }

    if (unused.length > 0) {
      const observedFrom = this.latest([
        role.createdAt,
        ...unused.map((p) => this.usage.observedSince.get(p) ?? this.guild.now),
      ]);
      const actionableAt = new Date(
        observedFrom.getTime() + MIN_CONFIDENCE_DAYS * DAY_MS,
      );
      const lowConfidence = actionableAt > this.guild.now;

      findings.push(
        rate(
          {
            type: "unused_role_permission",
            roleId: role.id,
            permissions: unused,
            holderCount: humans.length,
            lowConfidence,
            actionableAt: lowConfidence ? actionableAt : null,
          },
          highestSeverity(unused),
        ),
      );
    }

    if (viaBots.length > 0) {
      findings.push(
        rate(
          {
            type: "possibly_used_through_bots",
            roleId: role.id,
            permissions: viaBots,
          },
          "low",
        ),
      );
    }

    const inactive = settled.filter((member) => !active.includes(member));
    if (settled.length > 0 && inactive.length * 2 > settled.length) {
      findings.push(
        rate(
          {
            type: "inactive_holders",
            roleId: role.id,
            holderCount: humans.length,
            inactiveIds: inactive.map((member) => member.id),
          },
          "medium",
        ),
      );
    }

    return { findings, notTracked };
  }

  selfAssignableFindings(): RatedFinding[] {
    return this.guild.selfAssignable.flatMap((assignable) => {
      const role = this.rolesById.get(assignable.roleId);
      if (!role) {
        return [];
      }

      const permissions = permissionsIn(
        role.permissions,
        DANGEROUS_PERMISSIONS,
      );
      if (permissions.length === 0) {
        return [];
      }

      return [
        rate(
          {
            type: "self_assignable_role",
            roleId: role.id,
            permissions,
            source: assignable.source,
            restricted: assignable.restricted,
          },
          assignable.restricted ? "high" : "critical",
        ),
      ];
    });
  }

  /** Manage Roles lets a member assign any lower, non-managed role, whatever it grants. */
  escalationFindings(): RatedFinding[] {
    const findings: RatedFinding[] = [];

    for (const role of this.guild.roles) {
      if (
        role.id === this.guild.everyoneRoleId ||
        role.botUserId ||
        !hasPermission(role.permissions, "ManageRoles") ||
        hasPermission(role.permissions, "Administrator") ||
        this.humans(role.holderIds).length === 0
      ) {
        continue;
      }

      const own = new Set(
        permissionsIn(role.permissions, DANGEROUS_PERMISSIONS),
      );
      let best: { role: RoleSnapshot; gained: PermissionName[] } | null = null;

      for (const lower of this.guild.roles) {
        if (
          lower.position >= role.position ||
          lower.id === this.guild.everyoneRoleId ||
          lower.botUserId
        ) {
          continue;
        }

        const gained = permissionsIn(
          lower.permissions,
          DANGEROUS_PERMISSIONS,
        ).filter((permission) => !own.has(permission));
        if (gained.length === 0) {
          continue;
        }

        if (
          !best ||
          compareSeverity(
            highestSeverity(gained),
            highestSeverity(best.gained),
          ) < 0
        ) {
          best = { role: lower, gained };
        }
      }

      if (best) {
        findings.push(
          rate(
            {
              type: "escalation",
              roleId: role.id,
              reachableRoleId: best.role.id,
              gainedPermissions: best.gained,
            },
            "high",
          ),
        );
      }
    }

    return findings;
  }

  overwriteFindings(): RatedFinding[] {
    return this.guild.overwrites.flatMap((overwrite) => {
      const targetRole =
        overwrite.targetType === "role"
          ? this.rolesById.get(overwrite.targetId)
          : undefined;

      if (
        targetRole &&
        hasPermission(targetRole.permissions, "Administrator")
      ) {
        return [
          rate(
            {
              type: "dead_overwrite",
              channelId: overwrite.channelId,
              channelName: overwrite.channelName,
              targetId: overwrite.targetId,
            },
            "low",
          ),
        ];
      }

      const permissions = permissionsIn(overwrite.allow, DANGEROUS_PERMISSIONS);
      if (permissions.length === 0) {
        return [];
      }

      return [
        rate(
          {
            type: "dangerous_overwrite",
            channelId: overwrite.channelId,
            channelName: overwrite.channelName,
            targetId: overwrite.targetId,
            targetType: overwrite.targetType,
            permissions,
          },
          highestSeverity(permissions),
        ),
      ];
    });
  }

  mfaFindings(): RatedFinding[] {
    if (this.guild.mfaRequired) {
      return [];
    }

    const roleIds = this.guild.roles
      .filter(
        (role) =>
          role.id !== this.guild.everyoneRoleId &&
          !role.botUserId &&
          this.humans(role.holderIds).length > 0 &&
          permissionsIn(role.permissions, MFA_GATED_PERMISSIONS).length > 0,
      )
      .map((role) => role.id);

    return roleIds.length > 0
      ? [rate({ type: "mfa_disabled", roleIds }, "high")]
      : [];
  }

  memberInsights(): MemberInsight[] {
    const insights: MemberInsight[] = [];

    for (const member of this.guild.members.values()) {
      if (member.isBot || member.id === this.guild.ownerId) {
        continue;
      }

      const roles = this.memberRoles(member);
      const isAdmin = roles.some((role) =>
        hasPermission(role.permissions, "Administrator"),
      );
      const permissions = isAdmin
        ? [...DANGEROUS_PERMISSIONS]
        : DANGEROUS_PERMISSIONS.filter((permission) =>
            roles.some((role) => hasPermission(role.permissions, permission)),
          );

      if (permissions.length === 0) {
        continue;
      }

      insights.push({
        memberId: member.id,
        username: member.username,
        permissions: permissions.map((permission) => {
          const lastUsedAt =
            this.usage.lastUsed.get(member.id)?.get(permission) ?? null;
          return {
            permission,
            lastUsedAt,
            mayBeUsedThroughBots:
              lastUsedAt == null && this.botExecuted.has(permission),
          };
        }),
        viaRoleIds: roles
          .filter(
            (role) =>
              role.id !== this.guild.everyoneRoleId &&
              permissionsIn(role.permissions, DANGEROUS_PERMISSIONS).length > 0,
          )
          .map((role) => role.id),
      });
    }

    const neverUsed = (insight: MemberInsight) =>
      insight.permissions.filter((p) => p.lastUsedAt == null).length;
    return insights.sort((a, b) => neverUsed(b) - neverUsed(a));
  }

  holderCounts(): Partial<Record<PermissionName, number>> {
    const counts: Partial<Record<PermissionName, number>> = {};

    for (const permission of CONCENTRATION_PERMISSIONS) {
      counts[permission] = [...this.guild.members.values()].filter((member) => {
        if (member.isBot) {
          return false;
        }
        const roles = this.memberRoles(member);
        return roles.some(
          (role) =>
            hasPermission(role.permissions, permission) ||
            hasPermission(role.permissions, "Administrator"),
        );
      }).length;
    }

    return counts;
  }

  private memberRoles(member: MemberSnapshot): RoleSnapshot[] {
    return [this.guild.everyoneRoleId, ...member.roleIds]
      .map((roleId) => this.rolesById.get(roleId))
      .filter((role) => role !== undefined);
  }

  private humans(userIds: readonly string[]): MemberSnapshot[] {
    return userIds
      .map((userId) => this.guild.members.get(userId))
      .filter(
        (member): member is MemberSnapshot =>
          member !== undefined && !member.isBot,
      );
  }

  private usedInWindow(userId: string, permission: PermissionName): boolean {
    const lastUsed = this.usage.lastUsed.get(userId)?.get(permission);
    return lastUsed != null && lastUsed >= this.windowStart;
  }

  private latest(dates: Date[]): Date {
    return new Date(Math.max(...dates.map((date) => date.getTime())));
  }
}
