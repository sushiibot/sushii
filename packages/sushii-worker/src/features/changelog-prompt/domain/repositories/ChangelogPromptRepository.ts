import type { GuildChangelogPromptData } from "../GuildChangelogPrompt";

export interface ChangelogPromptRepository {
  findByGuildId(guildId: bigint): Promise<GuildChangelogPromptData | null>;
  upsert(data: GuildChangelogPromptData): Promise<void>;
}
