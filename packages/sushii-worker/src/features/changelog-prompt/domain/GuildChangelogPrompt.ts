export interface GuildChangelogPromptData {
  guildId: bigint;
  lastPromptedAt: Date | null;
  snoozeUntil: Date | null;
  dismissedAt: Date | null;
  followedAt: Date | null;
}
