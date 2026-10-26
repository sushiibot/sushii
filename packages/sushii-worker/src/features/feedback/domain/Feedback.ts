export const FEEDBACK_SOURCES = ["error_report", "panel"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const FEEDBACK_KINDS = [
  "idea",
  "confusing",
  "broken",
  "praise",
  "other",
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_OPTIONS: Record<
  FeedbackKind,
  { emoji: string; label: string }
> = {
  idea: { emoji: "💡", label: "Idea or request" },
  confusing: { emoji: "🤔", label: "Something's confusing" },
  broken: { emoji: "🐛", label: "Something's not working" },
  praise: { emoji: "❤️", label: "Something I like" },
  other: { emoji: "💬", label: "Other" },
};

export const FEATURE_LABELS = {
  "settings.overview": "Overview settings",
  "settings.logging": "Logging settings",
  "settings.moderation": "Moderation settings",
  "settings.automod": "Automod settings",
  "settings.welcome": "Welcome settings",
  "permission-audit": "Permission audit",
} as const;
export type FeedbackFeatureKey = keyof typeof FEATURE_LABELS;

export function isFeedbackFeature(value: string): value is FeedbackFeatureKey {
  return Object.hasOwn(FEATURE_LABELS, value);
}

export function isFeedbackSource(value: string): value is FeedbackSource {
  return (FEEDBACK_SOURCES as readonly string[]).includes(value);
}

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value);
}

export const FEEDBACK_CONTENT_MIN_LENGTH = 10;
export const FEEDBACK_CONTENT_MAX_LENGTH = 1000;

export interface Feedback {
  id: number;
  userId: string;
  guildId: string | null;
  source: FeedbackSource;
  kind: FeedbackKind;
  feature: FeedbackFeatureKey | null;
  traceId: string | null;
  content: string;
  createdAt: Date;
}

export type NewFeedback = Omit<Feedback, "id" | "createdAt">;

export interface FeedbackRepository {
  /** Inserts only if the user has fewer than `limit` rows in the last `windowSeconds`; null otherwise. */
  insertWithinLimit(
    feedback: NewFeedback,
    limit: number,
    windowSeconds: number,
  ): Promise<Feedback | null>;
}

/** Display-only context for the staff post; not stored. */
export interface FeedbackReporter {
  username: string;
  guildName: string | null;
}

export type PublishOutcome = "published" | "not_configured";

export interface FeedbackPublisher {
  publish(
    feedback: Feedback,
    reporter: FeedbackReporter,
  ): Promise<PublishOutcome>;
}
