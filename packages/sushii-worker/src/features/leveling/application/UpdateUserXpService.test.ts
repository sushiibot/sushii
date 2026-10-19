import { beforeEach, describe, expect, it, mock } from "bun:test";

import { LevelRole } from "../domain/entities/LevelRole";
import { UserLevel } from "../domain/entities/UserLevel";
import type { LevelRoleRepository } from "../domain/repositories/LevelRoleRepository";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import type { XpBlockRepository } from "../domain/repositories/XpBlockRepository";
import { UpdateUserXpService } from "./UpdateUserXpService";

const GUILD_ID = "100";
const CHANNEL_ID = "200";
const USER_ID = "300";

function twoMinutesAgo(): Date {
  return new Date(Date.now() - 2 * 60 * 1000);
}

function existingLevel(xp: number, lastMsg: Date = twoMinutesAgo()) {
  return new UserLevel(USER_ID, GUILD_ID, xp, xp, xp, xp, lastMsg);
}

describe("UpdateUserXpService", () => {
  let findByUserAndGuild: ReturnType<typeof mock>;
  let save: ReturnType<typeof mock>;
  let create: ReturnType<typeof mock>;
  let service: UpdateUserXpService;

  beforeEach(() => {
    findByUserAndGuild = mock(async (): Promise<UserLevel | null> => null);
    save = mock(async () => {});
    create = mock(async () => true);

    const userLevelRepository = {
      findByUserAndGuild,
      save,
      create,
    } as unknown as UserLevelRepository;

    const levelRoleRepository = {
      findByGuild: mock(async () => [
        LevelRole.create(GUILD_ID, "role-lvl1", 1, 2),
        LevelRole.create(GUILD_ID, "role-lvl2", 2),
      ]),
    } as unknown as LevelRoleRepository;

    const xpBlockRepository = {
      findActiveBlocks: mock(async () => []),
    } as unknown as XpBlockRepository;

    service = new UpdateUserXpService(
      userLevelRepository,
      levelRoleRepository,
      xpBlockRepository,
    );
  });

  it("reports the level-up on the message that crosses the threshold", async () => {
    // 95 XP = level 1, +5 = 100 XP = level 2
    findByUserAndGuild.mockResolvedValue(existingLevel(95));

    const result = await service.execute(GUILD_ID, CHANNEL_ID, USER_ID, []);

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.oldLevel).toBe(1);
    expect(result.newLevel).toBe(2);
    expect(result.addRoleIds).toEqual(["role-lvl2"]);
    expect(result.removeRoleIds).toEqual(["role-lvl1"]);
  });

  it("does not return role changes when the level did not change", async () => {
    findByUserAndGuild.mockResolvedValue(existingLevel(150));

    const result = await service.execute(GUILD_ID, CHANNEL_ID, USER_ID, []);

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.oldLevel).toBe(2);
    expect(result.newLevel).toBe(2);
    expect(result.addRoleIds).toBeNull();
    expect(result.removeRoleIds).toBeNull();
  });

  it("does nothing while on cooldown", async () => {
    findByUserAndGuild.mockResolvedValue(existingLevel(95, new Date()));

    const result = await service.execute(GUILD_ID, CHANNEL_ID, USER_ID, []);

    expect(save).not.toHaveBeenCalled();
    expect(result.oldLevel).toBeNull();
    expect(result.newLevel).toBeNull();
  });

  it("creates a new level row on the first message", async () => {
    const result = await service.execute(GUILD_ID, CHANNEL_ID, USER_ID, []);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.oldLevel).toBe(0);
    expect(result.newLevel).toBe(1);
    expect(result.addRoleIds).toEqual(["role-lvl1"]);
  });

  it("treats a concurrently created row as a no-op", async () => {
    // Another message created the row between our read and insert, so this
    // message falls inside the cooldown of that one.
    create.mockResolvedValue(false);

    const result = await service.execute(GUILD_ID, CHANNEL_ID, USER_ID, []);

    expect(create).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(result.oldLevel).toBeNull();
    expect(result.newLevel).toBeNull();
    expect(result.addRoleIds).toBeNull();
    expect(result.removeRoleIds).toBeNull();
  });
});
