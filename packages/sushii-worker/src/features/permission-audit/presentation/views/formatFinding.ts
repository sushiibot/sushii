import type { BotRoleSummary, RatedFinding } from "../../domain/Finding";
import type { PermissionName } from "../../domain/PermissionUsage";
import { type Severity, permissionLabel } from "../../domain/permissionCatalog";

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "⚪",
};

const MAX_LISTED = 5;

export function severityEmoji(severity: Severity): string {
  return SEVERITY_EMOJI[severity];
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

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One finding as markdown: a headline and a short `-#` line saying what to do. */
export function formatFinding(
  rated: RatedFinding,
  everyoneRoleId: string,
): string {
  const head = `${severityEmoji(rated.severity)} `;
  const f = rated.finding;

  switch (f.type) {
    case "everyone_dangerous":
      return `${head}@everyone has **${formatPermissions(f.permissions)}**\n-# Every member has these. Suggested: remove them.`;

    case "administrator_grant": {
      const title = `${head}${role(f.roleId, everyoneRoleId)} has **Administrator** · ${plural(f.holderCount, "holder")}`;
      if (f.isBotRole) {
        return `${title}\n-# Held by a bot. Give the bot only the permissions it needs.`;
      }
      if (f.lowConfidence) {
        return f.actionableAt
          ? `${title}\n-# Not enough history yet. Check again after ${discordDate(f.actionableAt)}.`
          : `${title}\n-# sushii needs View Audit Log to see what it's used for.`;
      }
      return f.usedPermissions.length > 0
        ? `${title}\n-# Only used ${formatPermissions(f.usedPermissions)}. Suggested: swap Administrator for those plus basic permissions.`
        : `${title}\n-# No dangerous permissions used. Suggested: swap Administrator for basic permissions.`;
    }

    case "unused_role_permission":
      return `${head}${role(f.roleId, everyoneRoleId)} · ${formatPermissions(f.permissions)}\n-# Unused by its ${plural(f.holderCount, "holder")} in 45 days. Suggested: remove.`;

    case "possibly_used_through_bots":
      return `${head}${role(f.roleId, everyoneRoleId)} · ${formatPermissions(f.permissions)}\n-# Only a bot used these, maybe on a holder's behalf. Not suggested for removal.`;

    case "self_assignable_role":
      return `${head}${role(f.roleId, everyoneRoleId)} has **${formatPermissions(f.permissions)}** and is self-assignable\n-# ${f.restricted ? "Members with the required role" : "Anyone"} can take it from the ${f.source}. Remove it there or remove the permissions.`;

    case "escalation":
      return `${head}${role(f.roleId, everyoneRoleId)} can give out ${role(f.reachableRoleId, everyoneRoleId)}\n-# That grants ${formatPermissions(f.gainedPermissions)}. Suggested: move ${role(f.reachableRoleId, everyoneRoleId)} higher, or remove Manage Roles.`;

    case "mfa_disabled":
      return `${head}Server-wide 2FA is off\n-# ${plural(f.roleIds.length, "role")} would be protected. The owner can turn it on in Server Settings → Safety Setup.`;

    case "dangerous_overwrite": {
      const target =
        f.targetType === "role"
          ? role(f.targetId, everyoneRoleId)
          : `<@${f.targetId}>`;
      return `${head}<#${f.channelId}> · ${target} is allowed **${formatPermissions(f.permissions)}**\n-# Suggested: remove it from the channel override.`;
    }

    case "dead_overwrite":
      return `${head}<#${f.channelId}> · override on ${role(f.targetId, everyoneRoleId)} does nothing\n-# The role has Administrator, which ignores overrides. Suggested: delete it.`;
  }
}

/** Overview line for every finding of one type: what's wrong, then where. */
export function formatFindingGroup(
  group: readonly RatedFinding[],
  everyoneRoleId: string,
): string {
  const [first] = group;
  if (!first) {
    return "";
  }
  const head = `${severityEmoji(first.severity)} `;
  const count = group.length;
  const roles = (ids: readonly string[]) => {
    const unique = [...new Set(ids)];
    const listed = unique
      .slice(0, MAX_LISTED)
      .map((id) => role(id, everyoneRoleId));
    const rest = unique.length - listed.length;
    return rest > 0 ? `${listed.join(", ")} +${rest} more` : listed.join(", ");
  };
  const roleIds = group.flatMap(({ finding }) =>
    "roleId" in finding ? [finding.roleId] : [],
  );
  const channels = () => {
    const unique = [
      ...new Set(
        group.flatMap(({ finding }) =>
          "channelId" in finding ? [finding.channelId] : [],
        ),
      ),
    ];
    const listed = unique.slice(0, MAX_LISTED).map((id) => `<#${id}>`);
    const rest = unique.length - listed.length;
    return rest > 0 ? `${listed.join(", ")} +${rest} more` : listed.join(", ");
  };
  const many = (one: string, several: string) =>
    count === 1 ? one : `${count} ${several}`;

  switch (first.finding.type) {
    case "everyone_dangerous":
      return `${head}**@everyone has ${formatPermissions(first.finding.permissions)}**\n-# See Roles`;
    case "administrator_grant":
      return `${head}**${many("1 role has", "roles have")} Administrator**\n-# ${roles(roleIds)} · see Roles`;
    case "unused_role_permission":
      return `${head}**${many("1 role has", "roles have")} unused permissions**\n-# ${roles(roleIds)} · see Unused`;
    case "possibly_used_through_bots":
      return `${head}**${many("1 role has", "roles have")} permissions only bots used**\n-# ${roles(roleIds)} · see Unused`;
    case "self_assignable_role":
      return `${head}**${many("1 self-assignable role has", "self-assignable roles have")} dangerous permissions**\n-# ${roles(roleIds)} · see Roles`;
    case "escalation":
      return `${head}**${many("1 role can", "roles can")} give out stronger roles**\n-# ${roles(roleIds)} · see Roles`;
    case "mfa_disabled":
      return `${head}**Server-wide 2FA is off**\n-# See Roles`;
    case "dangerous_overwrite":
      return `${head}**${many("1 channel override allows", "channel overrides allow")} dangerous permissions**\n-# ${channels()} · see Channels`;
    case "dead_overwrite":
      return `${head}**${many("1 channel override does", "channel overrides do")} nothing**\n-# ${channels()} · see Channels`;
  }
}

export function formatBot(bot: BotRoleSummary): string {
  const added = bot.addedRecently ? " · added in the last 45 days" : "";
  return `<@${bot.botUserId}> · <@&${bot.roleId}>${added}\n-# ${formatPermissions(bot.permissions)}`;
}
