import type {
  BotRoleSummary,
  MemberInsight,
  RatedFinding,
} from "../../domain/Finding";
import type { PermissionName } from "../../domain/PermissionUsage";
import { type Severity, permissionLabel } from "../../domain/permissionCatalog";

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "⚪ Low",
};

const MAX_LISTED_USERS = 5;

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABELS[severity];
}

export function formatPermissions(
  permissions: readonly PermissionName[],
): string {
  return permissions.map(permissionLabel).join(", ");
}

export function discordDate(date: Date, style: "D" | "R" = "D"): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function role(roleId: string, everyoneRoleId: string): string {
  return roleId === everyoneRoleId ? "@everyone" : `<@&${roleId}>`;
}

function users(userIds: readonly string[]): string {
  const listed = userIds.slice(0, MAX_LISTED_USERS).map((id) => `<@${id}>`);
  const rest = userIds.length - listed.length;
  return rest > 0 ? `${listed.join(", ")} +${rest} more` : listed.join(", ");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One finding as markdown: a severity headline and a `-#` line saying what to do. */
export function formatFinding(
  rated: RatedFinding,
  everyoneRoleId: string,
): string {
  const head = `${severityLabel(rated.severity)} · `;
  const f = rated.finding;

  switch (f.type) {
    case "everyone_dangerous":
      return `${head}@everyone has **${formatPermissions(f.permissions)}**\n-# Every member has these. Suggested: remove them from @everyone.`;

    case "administrator_grant":
      if (f.isBotRole) {
        return `${head}${role(f.roleId, everyoneRoleId)} (bot role) has **Administrator**\n-# Manual: bots rely on permissions sushii can't track. Re-invite the bot with only the permissions it needs.`;
      }
      if (f.lowConfidence) {
        return f.actionableAt
          ? `${head}${role(f.roleId, everyoneRoleId)} has **Administrator** (${plural(f.holderCount, "holder")})\n-# Not enough history yet to suggest a replacement. Check again after ${discordDate(f.actionableAt)}.`
          : `${head}${role(f.roleId, everyoneRoleId)} has **Administrator** (${plural(f.holderCount, "holder")})\n-# sushii needs View Audit Log to see which permissions it's actually used for.`;
      }
      return f.usedPermissions.length > 0
        ? `${head}${role(f.roleId, everyoneRoleId)} has **Administrator** (${plural(f.holderCount, "holder")})\n-# Only used ${formatPermissions(f.usedPermissions)} in 45 days. Suggested: replace with those plus the non-dangerous permissions.`
        : `${head}${role(f.roleId, everyoneRoleId)} has **Administrator** (${plural(f.holderCount, "holder")})\n-# None of its dangerous permissions were used in 45 days. Suggested: replace it with non-dangerous permissions.`;

    case "unused_role_permission":
      return `${head}${role(f.roleId, everyoneRoleId)} · ${formatPermissions(f.permissions)}\n-# Not used by any of its ${plural(f.holderCount, "holder")} in 45 days. Suggested: remove from the role.`;

    case "possibly_used_through_bots":
      return `${head}${role(f.roleId, everyoneRoleId)} · ${formatPermissions(f.permissions)}\n-# No holder used these directly, but a bot did. They may be used through that bot, so they aren't suggested for removal.`;

    case "partially_used_role":
      return `${head}${role(f.roleId, everyoneRoleId)} · ${permissionLabel(f.permission)}\n-# ${f.holderCount} have it · ${f.activeCount} active · ${f.usedByIds.length} used it (${users(f.usedByIds)}). Suggested: move it to a separate role for them.`;

    case "inactive_holders":
      return `${head}${role(f.roleId, everyoneRoleId)} · ${f.inactiveIds.length} of ${plural(f.holderCount, "holder")} not active in 45 days\n-# Consider removing the role from: ${users(f.inactiveIds)}`;

    case "self_assignable_role":
      return `${head}${role(f.roleId, everyoneRoleId)} is in ${f.source} and has **${formatPermissions(f.permissions)}**\n-# ${f.restricted ? "Members with the required role" : "Any member"} can give themselves this role. Remove it from the ${f.source.startsWith("level") ? "level rewards" : "menu"} or remove the permissions.`;

    case "escalation":
      return `${head}${role(f.roleId, everyoneRoleId)} has Manage Roles and can give members ${role(f.reachableRoleId, everyoneRoleId)}\n-# That role has ${formatPermissions(f.gainedPermissions)}, which ${role(f.roleId, everyoneRoleId)} doesn't. Suggested: move ${role(f.reachableRoleId, everyoneRoleId)} above it, or remove Manage Roles.`;

    case "mfa_disabled":
      return `${head}Server-wide 2FA is off\n-# ${plural(f.roleIds.length, "role")} have permissions 2FA would protect. The server owner can turn on "Require 2FA for moderator actions" in Server Settings → Safety Setup.`;

    case "dangerous_overwrite": {
      const target =
        f.targetType === "role"
          ? role(f.targetId, everyoneRoleId)
          : `<@${f.targetId}>`;
      return `${head}<#${f.channelId}> · ${target} is allowed **${formatPermissions(f.permissions)}**\n-# Suggested: remove this from the channel permission override.`;
    }

    case "dead_overwrite":
      return `${head}<#${f.channelId}> · the override on ${role(f.targetId, everyoneRoleId)} does nothing\n-# The role has Administrator, which ignores channel permission overrides. Suggested: delete the override.`;
  }
}

export function formatBot(bot: BotRoleSummary): string {
  const added = bot.addedRecently ? " · added in the last 45 days" : "";
  return `<@${bot.botUserId}> · <@&${bot.roleId}>${added}\n-# ${formatPermissions(bot.permissions)}`;
}

export function formatMember(insight: MemberInsight): string {
  const neverUsed = insight.permissions.filter((p) => p.lastUsedAt == null);
  const viaBots = neverUsed.filter((p) => p.mayBeUsedThroughBots);
  const unused = neverUsed.filter((p) => !p.mayBeUsedThroughBots);
  const used = insight.permissions.filter((p) => p.lastUsedAt != null);

  const parts = [
    unused.length > 0
      ? `Never used: ${formatPermissions(unused.map((p) => p.permission))}`
      : null,
    viaBots.length > 0
      ? `May be used through bots: ${formatPermissions(viaBots.map((p) => p.permission))}`
      : null,
    used.length > 0
      ? `Used: ${used.map((p) => `${permissionLabel(p.permission)} ${discordDate(p.lastUsedAt as Date, "R")}`).join(", ")}`
      : null,
  ].filter((part) => part !== null);

  const via =
    insight.viaRoleIds.length > 0
      ? ` · via ${insight.viaRoleIds.map((id) => `<@&${id}>`).join(", ")}`
      : "";

  return `**${insight.username}**${via}\n-# ${parts.join(" · ")}`;
}
