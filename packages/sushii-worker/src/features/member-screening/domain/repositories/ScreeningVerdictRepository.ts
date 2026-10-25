import type {
  AutomodSummary,
  IgnoreReason,
  NewScreeningVerdict,
  ScreeningGuildStats,
  ScreeningVerdict,
} from "../types";

export interface ScreeningVerdictRepository {
  /** Drops `judged` unless the verdict is flagged. */
  insert(verdict: NewScreeningVerdict): Promise<ScreeningVerdict>;
  findById(id: number): Promise<ScreeningVerdict | null>;

  /** Across every guild: one avatar check per (user, avatar hash). */
  hasPfpVerdict(userId: string, avatarHash: string): Promise<boolean>;
  hasImageVerdict(guildId: string, imageKey: string): Promise<boolean>;
  /** Text, pfp and image verdicts created since the start of the current UTC day. */
  countChecksToday(guildId: string): Promise<number>;

  /** Latest flagged text verdict with a post and no outcome, created at or after `since`. */
  findOpenTextPost(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<ScreeningVerdict | null>;
  setPost(
    id: number,
    postChannelId: string,
    postMessageId: string,
  ): Promise<void>;
  /** Latest verdict attached to the post. */
  latestForPost(postMessageId: string): Promise<ScreeningVerdict | null>;
  /** Flagged verdicts with a post for the user since `since`. */
  postedForUser(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<ScreeningVerdict[]>;
  hasFlagSince(guildId: string, userId: string, since: Date): Promise<boolean>;
  /** Latest successful (no error) text, pfp or image check for the user created at or after `since`: tells a screened-but-missed member from one never screened. */
  findLatestCheckSince(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<{ joinedAt: Date | null } | null>;
  /** A `miss` row for the user created at or after `since`, so repeated actions record one miss. */
  hasMissSince(guildId: string, userId: string, since: Date): Promise<boolean>;
  automodSummary(
    guildId: string,
    userId: string,
    since: Date,
  ): Promise<AutomodSummary>;

  /** Marks every outcome-less verdict on the post ignored. Returns the changed rows. */
  setIgnored(
    postMessageId: string,
    by: string,
    reason: IgnoreReason,
    at: Date,
  ): Promise<ScreeningVerdict[]>;
  /** Marks the user's flagged verdicts since `since` that have no outcome or were ignored as actioned: a mod action overrides an Ignore. Returns the changed rows. */
  setActioned(
    guildId: string,
    userId: string,
    since: Date,
    by: string | null,
    action: string,
    at: Date,
  ): Promise<ScreeningVerdict[]>;
  /** Follow-up action on an already-actioned post (unban, timeout removed). Returns the changed rows. */
  updateOutcomeAction(
    postMessageId: string,
    action: string,
    by: string,
    at: Date,
  ): Promise<ScreeningVerdict[]>;
  /** Returns flagged rows with a post whose message was deleted. */
  markMessageDeleted(messageIds: string[]): Promise<ScreeningVerdict[]>;

  statsSince(since: Date): Promise<ScreeningGuildStats[]>;
  deleteOlderThan(date: Date): Promise<number>;
}
