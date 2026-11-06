import { ALL_FEATURES, UNMATCHED_FEATURE } from "./ProductEvent";

export type FeatureUnit = "user" | "guild";

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
export function unitsForFeature(feature: string): readonly FeatureUnit[] {
  if (feature === ALL_FEATURES) {
    return ["user", "guild"];
  }
  const unit = PRODUCT_FEATURES[feature]?.unit;
  return unit ? [unit] : [];
}
