import type { PromptStateData, PromptSubject } from "../PromptState";

export interface PromptStateRepository {
  find(
    subject: PromptSubject,
    promptId: string,
  ): Promise<PromptStateData | null>;

  /**
   * Atomically sets lastPromptedAt = now if it's null or before
   * `cooldownThreshold` (null threshold = only if never shown).
   * Returns the previous value when claimed, or false if another caller won.
   */
  claim(
    subject: PromptSubject,
    promptId: string,
    cooldownThreshold: Date | null,
  ): Promise<{ previous: Date | null } | false>;

  /** Undoes a claim whose message couldn't be sent. */
  release(
    subject: PromptSubject,
    promptId: string,
    previous: Date | null,
  ): Promise<void>;

  /** Latest time any prompt was shown to this user, for the global per-user cap. */
  lastShownToUser(userId: bigint): Promise<Date | null>;

  /** Records that a user saw a prompt, so the global cap counts guild prompts too. */
  recordShownToUser(userId: bigint, promptId: string, at: Date): Promise<void>;

  recordSnoozed(
    subject: PromptSubject,
    promptId: string,
    snoozeUntil: Date,
  ): Promise<void>;
  recordDismissed(subject: PromptSubject, promptId: string): Promise<void>;
  recordCompleted(subject: PromptSubject, promptId: string): Promise<void>;
}
