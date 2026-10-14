import { PermissionFlagsBits } from "discord.js";

import type { PermissionName } from "./PermissionUsage";

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

const SEVERITY_TIERS: Record<Exclude<Severity, "low">, PermissionName[]> = {
  critical: ["Administrator", "ManageGuild", "ManageRoles", "ManageWebhooks"],
  high: [
    "BanMembers",
    "KickMembers",
    "ManageChannels",
    "ModerateMembers",
    "MentionEveryone",
  ],
  medium: [
    "ManageMessages",
    "ManageThreads",
    "ManageGuildExpressions",
    "ManageEvents",
    "ManageNicknames",
    "MoveMembers",
    "MuteMembers",
    "DeafenMembers",
  ],
};

const SEVERITY_BY_PERMISSION = new Map<PermissionName, Severity>(
  Object.entries(SEVERITY_TIERS).flatMap(([severity, permissions]) =>
    permissions.map((permission) => [permission, severity as Severity]),
  ),
);

/** Permissions the audit reports on, most severe first. */
export const DANGEROUS_PERMISSIONS: readonly PermissionName[] = [
  ...SEVERITY_TIERS.critical,
  ...SEVERITY_TIERS.high,
  ...SEVERITY_TIERS.medium,
];

/** Server-wide 2FA applies to these, per Discord's permission docs. */
export const MFA_GATED_PERMISSIONS: readonly PermissionName[] = [
  "KickMembers",
  "BanMembers",
  "Administrator",
  "ManageChannels",
  "ManageGuild",
  "ManageMessages",
  "ManageRoles",
  "ManageWebhooks",
  "ManageGuildExpressions",
  "ManageThreads",
  "ViewCreatorMonetizationAnalytics",
];

export function severityOf(permission: PermissionName): Severity {
  return SEVERITY_BY_PERMISSION.get(permission) ?? "low";
}

export function highestSeverity(
  permissions: readonly PermissionName[],
): Severity {
  for (const severity of SEVERITY_ORDER) {
    if (permissions.some((p) => severityOf(p) === severity)) {
      return severity;
    }
  }

  return "low";
}

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

export function hasPermission(
  bitfield: bigint,
  permission: PermissionName,
): boolean {
  return (bitfield & PermissionFlagsBits[permission]) !== 0n;
}

export function permissionsIn(
  bitfield: bigint,
  candidates: readonly PermissionName[],
): PermissionName[] {
  return candidates.filter((permission) => hasPermission(bitfield, permission));
}

const DISCORD_LABELS: Partial<Record<PermissionName, string>> = {
  ManageGuild: "Manage Server",
  ModerateMembers: "Timeout Members",
  MentionEveryone: "Mention @everyone, @here, and All Roles",
  ManageGuildExpressions: "Manage Expressions",
  CreateGuildExpressions: "Create Expressions",
  SendTTSMessages: "Send Text-to-Speech Messages",
  CreateInstantInvite: "Create Invite",
  ViewGuildInsights: "View Server Insights",
};

/** The name Discord's own settings UI shows for a permission. */
export function permissionLabel(permission: PermissionName): string {
  return (
    DISCORD_LABELS[permission] ?? permission.replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}
