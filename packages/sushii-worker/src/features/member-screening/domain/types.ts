export const SCREENING_RULE_IDS = [
  "scam",
  "sale",
  "promo",
  "sexual",
  "hate",
  "harassment",
  "underage",
] as const;
export type ScreeningRuleId = (typeof SCREENING_RULE_IDS)[number];

export const IGNORE_REASONS = [
  "too_minor",
  "allowed_here",
  "not_violation",
  "wrong_category",
] as const;
export type IgnoreReason = (typeof IGNORE_REASONS)[number];

/** `automod` is a block recorded for recall measurement; `miss` is a mod action on a member who was never flagged. */
export type VerdictKind = "text" | "pfp" | "image" | "automod" | "miss";
export type ImageKind = "pfp" | "image";
export type VerdictOutcome = "ignored" | "actioned";

export interface CriteriaSide {
  what: string;
  examples: string[];
}

export interface ScreeningRule {
  id: ScreeningRuleId;
  /** Shown in the post title: "Suspicious message · likely <title>". */
  title: string;
  /** Off unless listed in the guild's rules. */
  optIn?: boolean;
  instructions: string;
  criteria: { true: CriteriaSide; false: CriteriaSide };
}

export interface JudgedLine {
  author: string;
  text: string;
}

export interface JudgedText {
  context: JudgedLine[];
  target: JudgedLine[];
  automod?: { rule: string; keyword: string | null };
}

export interface JudgedImage {
  reason: string;
}

export interface ScreeningVerdict {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  messageId: string;
  kind: VerdictKind;
  /** text/automod: probability per rule. */
  scores: Partial<Record<ScreeningRuleId, number>> | null;
  /** pfp/image: unsafe categories; automod: [rule name]; miss: [action]. */
  categories: string[] | null;
  topRule: ScreeningRuleId | null;
  flagged: boolean;
  avatarHash: string | null;
  imageKey: string | null;
  sourceUrl: string | null;
  joinedAt: Date | null;
  /** Message number since join, counting this one. */
  ordinal: number | null;
  model: string | null;
  cost: number | null;
  /** Kept only for flagged verdicts. */
  judged: JudgedText | JudgedImage | null;
  error: string | null;
  postChannelId: string | null;
  postMessageId: string | null;
  outcome: VerdictOutcome | null;
  outcomeBy: string | null;
  /** "banned" | "kicked" | "timed out" | "unbanned" | "timeout removed" */
  outcomeAction: string | null;
  ignoreReason: IgnoreReason | null;
  outcomeAt: Date | null;
  messageDeleted: boolean;
  createdAt: Date;
}

export type NewScreeningVerdict = Pick<
  ScreeningVerdict,
  "guildId" | "channelId" | "userId" | "messageId" | "kind" | "createdAt"
> &
  Partial<
    Pick<
      ScreeningVerdict,
      | "scores"
      | "categories"
      | "topRule"
      | "flagged"
      | "avatarHash"
      | "imageKey"
      | "sourceUrl"
      | "joinedAt"
      | "ordinal"
      | "model"
      | "cost"
      | "judged"
      | "error"
      | "outcome"
      | "outcomeBy"
      | "outcomeAction"
      | "outcomeAt"
    >
  >;

export interface ScreeningGuildSettings {
  guildId: string;
  /** Set by server moderators; screening also needs the flag and a log channel. */
  enabled: boolean;
  /** Unset = nothing is screened (see isScreeningActive). */
  logChannelId: string | null;
  /** Screen a member until this many messages since join... */
  maxMessages: number;
  /** ...or this many hours since join, whichever comes first. */
  windowHours: number;
  reviewThreshold: number;
  /** null = every rule not marked optIn. */
  rules: ScreeningRuleId[] | null;
  checkAvatars: boolean;
  /** Text + image checks per UTC day; beyond it checks are skipped. */
  dailyCheckCap: number;
}

export type ActiveScreeningSettings = ScreeningGuildSettings & {
  logChannelId: string;
};

export const SCREENING_DEFAULTS = {
  enabled: false,
  maxMessages: 20,
  windowHours: 72,
  reviewThreshold: 0.7,
  checkAvatars: true,
  dailyCheckCap: 2000,
} as const;

export function defaultScreeningSettings(
  guildId: string,
): ScreeningGuildSettings {
  return { guildId, logChannelId: null, rules: null, ...SCREENING_DEFAULTS };
}

export const VERDICT_RETENTION_DAYS = 90;

/** How far back a mod action marks a member's flags actioned or decides a miss. */
export const ACTION_LOOKBACK_DAYS = 7;

export interface AutomodSummary {
  count: number;
  rules: string[];
}

export interface ScreeningGuildStats {
  guildId: string;
  /** text + pfp + image verdicts */
  checks: number;
  /** flagged, actioned, ignored and awaiting count posts; an unposted verdict counts as its own. */
  flagged: number;
  actioned: number;
  ignored: number;
  /** flagged, posted, no outcome yet */
  awaiting: number;
  missed: number;
  cost: number;
}
