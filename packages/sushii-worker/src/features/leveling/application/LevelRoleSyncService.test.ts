import { describe, expect, it, mock } from "bun:test";

import { LevelRole } from "../domain/entities/LevelRole";
import { UserLevel } from "../domain/entities/UserLevel";
import type { LevelRoleRepository } from "../domain/repositories/LevelRoleRepository";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import { LevelRoleSyncService } from "./LevelRoleSyncService";

const GUILD_ID = "100";
const USER_ID = "300";

function createService(userLevel: UserLevel | null): LevelRoleSyncService {
  const userLevelRepository = {
    findByUserAndGuild: mock(async () => userLevel),
  } as unknown as UserLevelRepository;

  const levelRoleRepository = {
    findByGuild: mock(async () => [
      LevelRole.create(GUILD_ID, "role-lvl1", 1, 2),
      LevelRole.create(GUILD_ID, "role-lvl2", 2),
      LevelRole.create(GUILD_ID, "role-lvl10", 10),
    ]),
  } as unknown as LevelRoleRepository;

  return new LevelRoleSyncService(userLevelRepository, levelRoleRepository);
}

describe("LevelRoleSyncService", () => {
  it("returns every role the stored level qualifies for", async () => {
    // 150 XP = level 2
    const service = createService(
      new UserLevel(USER_ID, GUILD_ID, 150, 150, 150, 150, new Date()),
    );

    const changes = await service.getRoleChangesForMember(GUILD_ID, USER_ID);

    expect(changes).toEqual({
      level: 2,
      addRoleIds: ["role-lvl2"],
      removeRoleIds: ["role-lvl1"],
    });
  });

  it("returns null when the user has no stored level", async () => {
    const service = createService(null);

    const changes = await service.getRoleChangesForMember(GUILD_ID, USER_ID);

    expect(changes).toBeNull();
  });

  it("returns null lists when no roles apply", async () => {
    const service = createService(null);

    const changes = await service.getRoleChangesForLevel(GUILD_ID, 0);

    expect(changes).toEqual({ addRoleIds: null, removeRoleIds: null });
  });
});
