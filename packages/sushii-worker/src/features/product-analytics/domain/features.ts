import { ALL_FEATURES, UNMATCHED_FEATURE } from "./ProductEvent";

export type FeatureUnit = "user" | "guild";
export type FeatureAudience = "staff" | "member";

interface FeatureDefinition {
  unit: FeatureUnit;
  /** Class names of the handlers that belong to this feature. */
  handlers: readonly string[];
}

/** `productFeatures.test.ts` fails when a new interaction handler isn't listed here. */
export const PRODUCT_FEATURES: Readonly<Record<string, FeatureDefinition>> = {
  "alt-accounts": {
    unit: "guild",
    handlers: ["AltNicknameButtonHandler", "AltsCommand"],
  },
  automod: {
    unit: "guild",
    handlers: [
      "ScamCandidateButtonHandler",
      "ScamCandidateLabelModalHandler",
      "ScamHashCommand",
      "ScamHashReportButtonHandler",
      "IpGrabberRevertButtonHandler",
    ],
  },
  "emoji-stats": { unit: "guild", handlers: ["EmojiStatsCommand"] },
  feedback: {
    unit: "user",
    handlers: ["FeedbackButtonHandler", "FeedbackModalHandler"],
  },
  giveaways: {
    unit: "guild",
    handlers: ["GiveawayButtonHandler", "GiveawayCommand"],
  },
  "guild-settings": { unit: "guild", handlers: ["SettingsCommand"] },
  help: { unit: "user", handlers: ["HelpCommand", "HelpTabButtonHandler"] },
  leveling: {
    unit: "user",
    handlers: [
      "FishyCollectionCommand",
      "GlobalLeaderboardCommand",
      "LeaderboardCommand",
      "LeaderboardPrivacyCommand",
      "LevelRoleCommand",
      "OpenFishyCollectionButtonHandler",
      "RankCommand",
      "UserOverviewComponentHandler",
      "XpCommand",
    ],
  },
  "member-screening": {
    unit: "guild",
    handlers: [
      "MemberScreeningCommand",
      "ScreeningActionButtonHandler",
      "ScreeningIgnoreSelectHandler",
    ],
  },
  "message-verification": {
    unit: "guild",
    handlers: [
      "SubmitToModsContextMenuHandler",
      "VerifyMessageCommand",
      "VerifyMessageGuideCommand",
    ],
  },
  moderation: {
    unit: "guild",
    handlers: [
      "ActionResponseButtonHandler",
      "AddAsProofButtonHandler",
      "AddAsProofContextMenuHandler",
      "AddAsProofSelectHandler",
      "AddAsProofUndoButtonHandler",
      "AddProofButtonHandler",
      "AutomodAlertActionButtonHandler",
      "AutomodAlertRemoveTimeoutButtonHandler",
      "HistoryCommand",
      "LookupCommand",
      "ModLogDeleteDMButtonHandler",
      "ModLogReasonButtonHandler",
      "ModViewCommand",
      "ModViewContextMenuHandler",
      "ModerationCommand",
      "NamesCommand",
      "ProofCommand",
      "PruneCommand",
      "ReasonCommand",
      "ReasonTemplatesCommand",
      "ReasonTemplatesPanelButtonHandler",
      "SlowmodeCommand",
      "TempbanListCommand",
      "TemplateEditButtonHandler",
      "UncaseCommand",
    ],
  },
  notifications: { unit: "user", handlers: ["NotificationCommand"] },
  "permission-audit": { unit: "guild", handlers: ["PermissionAuditCommand"] },
  prompts: {
    unit: "user",
    handlers: ["PromptButtonHandler", "PromptSelectMenuHandler"],
  },
  "proof-suggestions": {
    unit: "guild",
    handlers: ["ProofSuggestionButtonHandler", "ProofSuggestionSelectHandler"],
  },
  "reaction-log": { unit: "guild", handlers: ["CheckReactionStartersCommand"] },
  reminders: { unit: "user", handlers: ["ReminderCommand"] },
  "role-menu": {
    unit: "guild",
    handlers: [
      "RoleMenuButtonHandler",
      "RoleMenuCommand",
      "RoleMenuSelectMenuHandler",
    ],
  },
  schedule: {
    unit: "guild",
    handlers: [
      "ScheduleCommand",
      "ScheduleConfigCommand",
      "ScheduleConfigDeleteButtonHandler",
      "ScheduleConfigNewButtonHandler",
    ],
  },
  "server-management": { unit: "guild", handlers: ["ServerCommand"] },
  social: {
    unit: "user",
    handlers: [
      "FishyCommand",
      "FishyLeaderboardCommand",
      "RepCommand",
      "RepLeaderboardCommand",
    ],
  },
  "sushii-updates": { unit: "guild", handlers: [] },
  tags: {
    unit: "guild",
    handlers: [
      "TagAddCommand",
      "TagAdminCommand",
      "TagEditCommand",
      "TagGetCommand",
      "TagInfoCommand",
    ],
  },
  "user-profile": {
    unit: "user",
    handlers: [
      "AvatarCommand",
      "BannerCommand",
      "UserInfoCommand",
      "UserInfoContextMenuHandler",
    ],
  },
};

/** Handlers for running a server; everything else in a feature is what members use. */
export const STAFF_HANDLERS: readonly string[] = [
  "ActionResponseButtonHandler",
  "AddAsProofButtonHandler",
  "AddAsProofContextMenuHandler",
  "AddAsProofSelectHandler",
  "AddAsProofUndoButtonHandler",
  "AddProofButtonHandler",
  "AltNicknameButtonHandler",
  "AltsCommand",
  "AutomodAlertActionButtonHandler",
  "AutomodAlertRemoveTimeoutButtonHandler",
  "CheckReactionStartersCommand",
  "GiveawayCommand",
  "HistoryCommand",
  "IpGrabberRevertButtonHandler",
  "LevelRoleCommand",
  "LookupCommand",
  "MemberScreeningCommand",
  "ModLogDeleteDMButtonHandler",
  "ModLogReasonButtonHandler",
  "ModViewCommand",
  "ModViewContextMenuHandler",
  "ModerationCommand",
  "NamesCommand",
  "PermissionAuditCommand",
  "PromptButtonHandler",
  "PromptSelectMenuHandler",
  "ProofCommand",
  "ProofSuggestionButtonHandler",
  "ProofSuggestionSelectHandler",
  "PruneCommand",
  "ReasonCommand",
  "ReasonTemplatesCommand",
  "ReasonTemplatesPanelButtonHandler",
  "RoleMenuCommand",
  "ScamCandidateButtonHandler",
  "ScamCandidateLabelModalHandler",
  "ScamHashCommand",
  "ScamHashReportButtonHandler",
  "ScheduleConfigCommand",
  "ScheduleConfigDeleteButtonHandler",
  "ScheduleConfigNewButtonHandler",
  "ScreeningActionButtonHandler",
  "ScreeningIgnoreSelectHandler",
  "ServerCommand",
  "SettingsCommand",
  "SlowmodeCommand",
  "TagAdminCommand",
  "TempbanListCommand",
  "TemplateEditButtonHandler",
  "UncaseCommand",
  "VerifyMessageCommand",
  "VerifyMessageGuideCommand",
  "XpCommand",
];

/** Operator tools, left out of product numbers on purpose. */
export const INTERNAL_HANDLERS: readonly string[] = [
  "DeploymentApprovalButtonHandler",
  "FeatureFlagCommand",
  "StatusCommand",
];

const FEATURE_BY_HANDLER = new Map(
  Object.entries(PRODUCT_FEATURES).flatMap(([feature, definition]) =>
    definition.handlers.map((handler) => [handler, feature] as const),
  ),
);

export function featureForHandler(handlerName: string | undefined): string {
  if (!handlerName) {
    return UNMATCHED_FEATURE;
  }
  return FEATURE_BY_HANDLER.get(handlerName) ?? UNMATCHED_FEATURE;
}

/** `all` covers both units, so it's reported for both. */
export function audienceForHandler(
  handlerName: string | undefined,
): FeatureAudience | undefined {
  if (featureForHandler(handlerName) === UNMATCHED_FEATURE) {
    return undefined;
  }
  return STAFF_HANDLERS.includes(handlerName as string) ? "staff" : "member";
}

export function unitsForFeature(feature: string): readonly FeatureUnit[] {
  if (feature === ALL_FEATURES) {
    return ["user", "guild"];
  }
  const unit = PRODUCT_FEATURES[feature]?.unit;
  return unit ? [unit] : [];
}
