import type { GuildConfig } from "../entities/GuildConfig";

export interface GuildConfigRepository {
  findByGuildId(guildId: string): Promise<GuildConfig>;
  save(configuration: GuildConfig): Promise<GuildConfig>;
}
