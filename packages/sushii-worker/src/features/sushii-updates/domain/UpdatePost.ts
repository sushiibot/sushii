export interface UpdatePost {
  messageId: string;
  createdAt: Date;
}

/** Announcements are published soon after posting; older crossposted messages are edits of past posts. */
export const PUBLISH_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DELIVERY_STATUSES = [
  "claimed",
  "sent",
  "failed",
  "skipped",
  "retry",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryOutcome = Exclude<DeliveryStatus, "claimed">;

/** A delivery that hit a temporary error is tried again until this many attempts. */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface RelayTarget {
  guildId: string;
  channelId: string;
}
