import type { PermissionName } from "./PermissionUsage";
import type { Severity } from "./permissionCatalog";

export type AuditTab = "roles" | "unused" | "channels";

export type Finding =
  | {
      type: "everyone_dangerous";
      roleId: string;
      permissions: PermissionName[];
    }
  | {
      type: "administrator_grant";
      roleId: string;
      holderCount: number;
      usedPermissions: PermissionName[];
      isBotRole: boolean;
      /** Too little history to know what the role is used for. */
      lowConfidence: boolean;
      /** When low confidence, the date it becomes actionable, or null if it never will without audit log access. */
      actionableAt: Date | null;
    }
  | {
      type: "unused_role_permission";
      roleId: string;
      permissions: PermissionName[];
      holderCount: number;
      lowConfidence: boolean;
      /** When low confidence, the date the finding becomes actionable. */
      actionableAt: Date | null;
    }
  | {
      type: "possibly_used_through_bots";
      roleId: string;
      permissions: PermissionName[];
    }
  | {
      type: "partially_used_role";
      roleId: string;
      permission: PermissionName;
      holderCount: number;
      activeCount: number;
      usedByIds: string[];
    }
  | {
      type: "inactive_holders";
      roleId: string;
      holderCount: number;
      inactiveIds: string[];
    }
  | {
      type: "self_assignable_role";
      roleId: string;
      permissions: PermissionName[];
      source: string;
      restricted: boolean;
    }
  | {
      type: "escalation";
      roleId: string;
      reachableRoleId: string;
      gainedPermissions: PermissionName[];
    }
  | {
      type: "dangerous_overwrite";
      channelId: string;
      channelName: string;
      targetId: string;
      targetType: "role" | "member";
      permissions: PermissionName[];
    }
  | {
      type: "dead_overwrite";
      channelId: string;
      channelName: string;
      targetId: string;
    }
  | {
      type: "mfa_disabled";
      roleIds: string[];
    };

export interface RatedFinding {
  finding: Finding;
  severity: Severity;
  tab: AuditTab;
}

export interface BotRoleSummary {
  roleId: string;
  botUserId: string;
  permissions: PermissionName[];
  addedRecently: boolean;
}

export interface MemberInsight {
  memberId: string;
  username: string;
  permissions: {
    permission: PermissionName;
    lastUsedAt: Date | null;
    mayBeUsedThroughBots: boolean;
  }[];
  viaRoleIds: string[];
}

export interface AuditReport {
  findings: RatedFinding[];
  bots: BotRoleSummary[];
  members: MemberInsight[];
  notTracked: { roleId: string; permissions: PermissionName[] }[];
  /** Members holding each permission, for the overview's concentration line. */
  holderCounts: Partial<Record<PermissionName, number>>;
}
