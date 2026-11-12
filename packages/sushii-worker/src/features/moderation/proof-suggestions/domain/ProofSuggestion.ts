export type SuggestionKind = "automod" | "deleted" | "recent";

export interface ProofSuggestion {
  kind: SuggestionKind;
  /** Alert channel for automod. */
  channelId: string;
  /** automod: where the user tried to post. */
  blockedInChannelId?: string;
  /** Target's messages, newest last; ≤10. */
  messageIds: string[];
  /** For "last 10 of N". */
  totalInWindow: number;
  firstAt: Date;
  lastAt: Date;
  /** ≤100 chars, escaped, for labels/descriptions. */
  snippet: string;
  /** automod */
  ruleName?: string;
  /** deleted/recent: messages already in the message log, for "(2 deleted)" labels. */
  deletedCount?: number;
}

export const SUGGESTION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_SUGGESTIONS = 10;
export const MAX_AUTOMOD_SUGGESTIONS = 3;
export const MAX_TARGET_MESSAGES = 10;
export const SNIPPET_MAX_LENGTH = 100;
