import { AuditLogEvent } from "discord.js";

import type {
  PermissionName,
  PermissionUsage,
  PermissionUsageDetector,
} from "../PermissionUsage";

export interface AuditLogEntryInput {
  guildId: string;
  action: AuditLogEvent;
  executorId: string | null;
  targetId: string | null;
  channelId: string | null;
  changeKeys: readonly string[];
  occurredAt: Date;
  /** Thread owner, when known. Owners can edit their own threads without Manage Threads. */
  targetOwnerId?: string | null;
}

const ACTION_PERMISSIONS: Partial<Record<AuditLogEvent, PermissionName>> = {
  [AuditLogEvent.GuildUpdate]: "ManageGuild",
  [AuditLogEvent.ChannelCreate]: "ManageChannels",
  [AuditLogEvent.ChannelUpdate]: "ManageChannels",
  [AuditLogEvent.ChannelDelete]: "ManageChannels",
  [AuditLogEvent.ChannelOverwriteCreate]: "ManageRoles",
  [AuditLogEvent.ChannelOverwriteUpdate]: "ManageRoles",
  [AuditLogEvent.ChannelOverwriteDelete]: "ManageRoles",
  [AuditLogEvent.MemberKick]: "KickMembers",
  [AuditLogEvent.MemberPrune]: "KickMembers",
  [AuditLogEvent.MemberBanAdd]: "BanMembers",
  [AuditLogEvent.MemberBanRemove]: "BanMembers",
  [AuditLogEvent.MemberMove]: "MoveMembers",
  [AuditLogEvent.MemberDisconnect]: "MoveMembers",
  [AuditLogEvent.BotAdd]: "ManageGuild",
  [AuditLogEvent.RoleCreate]: "ManageRoles",
  [AuditLogEvent.RoleUpdate]: "ManageRoles",
  [AuditLogEvent.RoleDelete]: "ManageRoles",
  [AuditLogEvent.WebhookCreate]: "ManageWebhooks",
  [AuditLogEvent.WebhookUpdate]: "ManageWebhooks",
  [AuditLogEvent.WebhookDelete]: "ManageWebhooks",
  [AuditLogEvent.EmojiCreate]: "CreateGuildExpressions",
  [AuditLogEvent.EmojiUpdate]: "ManageGuildExpressions",
  [AuditLogEvent.EmojiDelete]: "ManageGuildExpressions",
  [AuditLogEvent.StickerCreate]: "CreateGuildExpressions",
  [AuditLogEvent.StickerUpdate]: "ManageGuildExpressions",
  [AuditLogEvent.StickerDelete]: "ManageGuildExpressions",
  [AuditLogEvent.SoundboardSoundCreate]: "CreateGuildExpressions",
  [AuditLogEvent.SoundboardSoundUpdate]: "ManageGuildExpressions",
  [AuditLogEvent.SoundboardSoundDelete]: "ManageGuildExpressions",
  [AuditLogEvent.MessageBulkDelete]: "ManageMessages",
  [AuditLogEvent.MessagePin]: "PinMessages",
  [AuditLogEvent.MessageUnpin]: "PinMessages",
  [AuditLogEvent.IntegrationCreate]: "ManageGuild",
  [AuditLogEvent.IntegrationUpdate]: "ManageGuild",
  [AuditLogEvent.IntegrationDelete]: "ManageGuild",
  [AuditLogEvent.StageInstanceCreate]: "ManageChannels",
  [AuditLogEvent.StageInstanceUpdate]: "ManageChannels",
  [AuditLogEvent.StageInstanceDelete]: "ManageChannels",
  [AuditLogEvent.GuildScheduledEventCreate]: "CreateEvents",
  [AuditLogEvent.GuildScheduledEventUpdate]: "ManageEvents",
  [AuditLogEvent.GuildScheduledEventDelete]: "ManageEvents",
  [AuditLogEvent.ApplicationCommandPermissionUpdate]: "ManageGuild",
  [AuditLogEvent.AutoModerationRuleCreate]: "ManageGuild",
  [AuditLogEvent.AutoModerationRuleUpdate]: "ManageGuild",
  [AuditLogEvent.AutoModerationRuleDelete]: "ManageGuild",
  [AuditLogEvent.OnboardingPromptCreate]: "ManageGuild",
  [AuditLogEvent.OnboardingPromptUpdate]: "ManageGuild",
  [AuditLogEvent.OnboardingPromptDelete]: "ManageGuild",
  [AuditLogEvent.OnboardingCreate]: "ManageGuild",
  [AuditLogEvent.OnboardingUpdate]: "ManageGuild",
  [AuditLogEvent.HomeSettingsCreate]: "ManageGuild",
  [AuditLogEvent.HomeSettingsUpdate]: "ManageGuild",
};

const MEMBER_UPDATE_KEY_PERMISSIONS: Record<string, PermissionName> = {
  communication_disabled_until: "ModerateMembers",
  nick: "ManageNicknames",
  mute: "MuteMembers",
  deaf: "DeafenMembers",
};

const ACTIONS_ON_OTHERS_ONLY: Partial<Record<AuditLogEvent, PermissionName>> = {
  [AuditLogEvent.MemberRoleUpdate]: "ManageRoles",
  [AuditLogEvent.MessageDelete]: "ManageMessages",
};

const THREAD_ACTIONS = new Set<AuditLogEvent>([
  AuditLogEvent.ThreadUpdate,
  AuditLogEvent.ThreadDelete,
]);

/** Every action type that can produce usage; the backfill fetches only these. */
export const TRACKED_AUDIT_LOG_ACTIONS: readonly AuditLogEvent[] = [
  ...Object.keys(ACTION_PERMISSIONS).map(Number),
  AuditLogEvent.MemberUpdate,
  ...Object.keys(ACTIONS_ON_OTHERS_ONLY).map(Number),
  ...THREAD_ACTIONS,
];

export class AuditLogUsageDetector
  implements PermissionUsageDetector<AuditLogEntryInput>
{
  readonly source = "audit_log" as const;

  readonly observes: readonly PermissionName[] = [
    ...new Set<PermissionName>([
      ...Object.values(ACTION_PERMISSIONS),
      ...Object.values(MEMBER_UPDATE_KEY_PERMISSIONS),
      ...Object.values(ACTIONS_ON_OTHERS_ONLY),
      "ManageThreads",
    ]),
  ];

  /**
   * @param getSelfUserId sushii's own user ID, skipped because sushii records
   * the invoking moderator directly. A getter since it's unknown until login.
   */
  constructor(private readonly getSelfUserId: () => string | undefined) {}

  detect(entry: AuditLogEntryInput): PermissionUsage[] {
    const { executorId } = entry;
    if (!executorId || executorId === this.getSelfUserId()) {
      return [];
    }

    return this.permissionsFor(entry).map((permission) => ({
      guildId: entry.guildId,
      userId: executorId,
      permission,
      source: this.source,
      channelId: entry.channelId,
      occurredAt: entry.occurredAt,
    }));
  }

  private permissionsFor(entry: AuditLogEntryInput): PermissionName[] {
    const actingOnSelf = entry.targetId === entry.executorId;

    if (entry.action === AuditLogEvent.MemberUpdate) {
      if (actingOnSelf) {
        return [];
      }

      return [
        ...new Set(
          entry.changeKeys
            .map((key) => MEMBER_UPDATE_KEY_PERMISSIONS[key])
            .filter((permission) => permission !== undefined),
        ),
      ];
    }

    const othersOnly = ACTIONS_ON_OTHERS_ONLY[entry.action];
    if (othersOnly) {
      return actingOnSelf ? [] : [othersOnly];
    }

    if (THREAD_ACTIONS.has(entry.action)) {
      const ownerKnownAndDifferent =
        entry.targetOwnerId != null && entry.targetOwnerId !== entry.executorId;

      return ownerKnownAndDifferent ? ["ManageThreads"] : [];
    }

    const permission = ACTION_PERMISSIONS[entry.action];
    return permission ? [permission] : [];
  }
}
