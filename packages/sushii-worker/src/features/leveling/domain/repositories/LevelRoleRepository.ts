import { LevelRole } from "../entities/LevelRole";

export interface LevelRoleRepository {
  findByGuild(guildId: string): Promise<LevelRole[]>;
  findByGuildAndRole(guildId: string, roleId: string): Promise<LevelRole | null>;
  save(levelRole: LevelRole): Promise<void>;
  deleteByGuildAndRole(guildId: string, roleId: string): Promise<boolean>;
}
