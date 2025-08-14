import type { AuditLogEvent } from "discord.js";

import type { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import type { MockUserData } from "../../helpers/mockUsers";

export interface ModerationTestCase {
  name: string;
  actionType: ActionType;
  commandName: string;

  // Setup configuration
  setup: {
    guildId: string;
    executorUser: MockUserData;
    targetUser: MockUserData;
    targetExists: boolean; // User exists in Discord
    targetIsMember: boolean; // User is guild member

    // Guild config settings
    guildConfig?: {
      modLogChannel?: string;
      banDmEnabled?: boolean; // Default: true
      timeoutCommandDmEnabled?: boolean; // Default: true
    };
  };

  // Command options
  commandOptions: {
    users?: string; // For ban
    user?: string; // For timeout
    reason?: string;
    dm_reason?: "yes_dm" | "no_dm" | null; // null = use guild default
    duration?: string; // For timeout/tempban
    days?: number; // For ban
    attachment?: boolean;
  };

  // Expected results
  expectations: {
    shouldSucceed: boolean;
    errorMessage?: string;

    discordApi: {
      ban?: { called: boolean; args?: unknown[] };
      kick?: { called: boolean };
      timeout?: { called: boolean; duration?: number };
      unban?: { called: boolean };
      createDM?: { called: boolean };
      dmSend?: { called: boolean };
    };

    moderationCase: {
      shouldCreate: boolean;
      pending: boolean;
      actionType: ActionType;
      reason?: string;
    };

    interaction: {
      deferReply: boolean;
      editReply: boolean;
      embedContains?: string[];
    };

    auditLog?: {
      event: AuditLogEvent;
      completesCase: boolean;
    };
  };
}
