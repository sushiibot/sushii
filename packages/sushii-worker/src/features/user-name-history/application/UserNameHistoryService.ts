import type {
  NameType,
  UserNameHistoryEntry,
  UserNameHistoryRepository,
} from "../domain";

export class UserNameHistoryService {
  constructor(private readonly repo: UserNameHistoryRepository) {}

  private async recordChange(
    nameType: NameType,
    userId: string,
    guildId: string | null,
    value: string | null,
  ): Promise<void> {
    await this.repo.insertIfChanged({
      userId: BigInt(userId),
      nameType,
      guildId: guildId !== null ? BigInt(guildId) : null,
      value,
    });
  }

  async recordUsernameChange(userId: string, newValue: string): Promise<void> {
    await this.recordChange("username", userId, null, newValue);
  }

  async recordGlobalNameChange(
    userId: string,
    newValue: string | null,
  ): Promise<void> {
    await this.recordChange("global_name", userId, null, newValue);
  }

  async recordNicknameChange(
    guildId: string,
    userId: string,
    newValue: string | null,
  ): Promise<void> {
    await this.recordChange("nickname", userId, guildId, newValue);
  }

  async getHistory(
    userId: string,
    limit?: number,
  ): Promise<UserNameHistoryEntry[]> {
    return this.repo.findByUserId(BigInt(userId), limit);
  }
}
