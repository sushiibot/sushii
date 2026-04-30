import type { PromptStateData } from "../PromptState";

export interface PromptStateRepository {
  findByGuildAndPrompt(
    guildId: bigint,
    promptId: string,
  ): Promise<PromptStateData | null>;

  /**
   * Atomically writes lastPromptedAt = now, but only if the current value is
   * null or before `cooldownThreshold`. Returns true if the slot was claimed
   * (i.e. the row was inserted or updated), false if another concurrent caller
   * already claimed it within the cooldown window.
   */
  claimPromptSlot(
    guildId: bigint,
    promptId: string,
    cooldownThreshold: Date | null,
  ): Promise<boolean>;

  recordSnoozed(guildId: bigint, promptId: string, snoozeUntil: Date): Promise<void>;
  recordDismissed(guildId: bigint, promptId: string): Promise<void>;
  recordCompleted(guildId: bigint, promptId: string): Promise<void>;
}
