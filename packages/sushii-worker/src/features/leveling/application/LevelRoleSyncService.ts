import type { LevelRoleRepository } from "../domain/repositories/LevelRoleRepository";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";

export interface LevelRoleChanges {
  addRoleIds: string[] | null;
  removeRoleIds: string[] | null;
}

export interface MemberLevelRoleChanges extends LevelRoleChanges {
  level: number;
}

export class LevelRoleSyncService {
  constructor(
    private readonly userLevelRepository: UserLevelRepository,
    private readonly levelRoleRepository: LevelRoleRepository,
  ) {}

  /**
   * Returns null if the user has no stored level in the guild.
   */
  async getRoleChangesForMember(
    guildId: string,
    userId: string,
  ): Promise<MemberLevelRoleChanges | null> {
    const userLevel = await this.userLevelRepository.findByUserAndGuild(
      userId,
      guildId,
    );

    if (!userLevel) {
      return null;
    }

    const level = userLevel.getCurrentLevel();
    const changes = await this.getRoleChangesForLevel(guildId, level);

    return { level, ...changes };
  }

  async getRoleChangesForLevel(
    guildId: string,
    level: number,
  ): Promise<LevelRoleChanges> {
    const levelRoles = await this.levelRoleRepository.findByGuild(guildId);

    const addRoleIds: string[] = [];
    const removeRoleIds: string[] = [];

    for (const levelRole of levelRoles) {
      if (levelRole.shouldAddRole(level)) {
        addRoleIds.push(levelRole.getRoleId());
      }

      if (levelRole.shouldRemoveRole(level)) {
        removeRoleIds.push(levelRole.getRoleId());
      }
    }

    return {
      addRoleIds: addRoleIds.length > 0 ? addRoleIds : null,
      removeRoleIds: removeRoleIds.length > 0 ? removeRoleIds : null,
    };
  }
}
