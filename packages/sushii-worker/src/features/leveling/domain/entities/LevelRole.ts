export class LevelRole {
  private constructor(
    private readonly guildId: string,
    private readonly roleId: string,
    private readonly addLevel: number | null,
    private readonly removeLevel: number | null,
  ) {
    if (guildId.trim() === "") {
      throw new Error("Guild ID cannot be empty");
    }
    if (roleId.trim() === "") {
      throw new Error("Role ID cannot be empty");
    }
    if (addLevel !== null && addLevel < 1) {
      throw new Error("Add level must be positive");
    }
    if (removeLevel !== null && removeLevel < 1) {
      throw new Error("Remove level must be positive");
    }
    if (addLevel !== null && removeLevel !== null && removeLevel <= addLevel) {
      throw new Error("Remove level must be higher than add level");
    }
  }

  static create(
    guildId: string,
    roleId: string,
    addLevel: number,
    removeLevel?: number,
  ): LevelRole {
    return new LevelRole(guildId, roleId, addLevel, removeLevel || null);
  }

  static reconstitute(
    guildId: string,
    roleId: string,
    addLevel: number | null,
    removeLevel: number | null,
  ): LevelRole {
    const instance = Object.create(LevelRole.prototype);
    instance.guildId = guildId;
    instance.roleId = roleId;
    instance.addLevel = addLevel;
    instance.removeLevel = removeLevel;
    return instance;
  }

  static isValidLevelRange(addLevel: number, removeLevel?: number): boolean {
    if (removeLevel === undefined || removeLevel === null) {
      return true;
    }
    return removeLevel > addLevel;
  }

  getGuildId(): string {
    return this.guildId;
  }

  getRoleId(): string {
    return this.roleId;
  }

  getAddLevel(): number | null {
    return this.addLevel;
  }

  getRemoveLevel(): number | null {
    return this.removeLevel;
  }

  shouldAddRole(level: number): boolean {
    return (
      this.addLevel !== null &&
      level >= this.addLevel &&
      (this.removeLevel === null || level < this.removeLevel)
    );
  }

  shouldRemoveRole(level: number): boolean {
    return this.removeLevel !== null && level >= this.removeLevel;
  }
}
