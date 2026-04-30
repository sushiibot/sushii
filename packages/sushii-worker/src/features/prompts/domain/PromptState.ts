export interface PromptStateData {
  guildId: bigint;
  promptId: string;
  lastPromptedAt: Date | null;
  snoozeUntil: Date | null;
  dismissedAt: Date | null;
  completedAt: Date | null;
}
