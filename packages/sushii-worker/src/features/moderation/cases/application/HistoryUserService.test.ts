import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { AltAccountRepository } from "@/features/alt-accounts/domain/repositories";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import { HistoryUserService } from "./HistoryUserService";

const GUILD_ID = "111111111111111111";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";

const testLogger = pino({ level: "silent" });

function makeIdentity(memberIds: string[]) {
  return makeAltIdentity({ guildId: GUILD_ID, memberIds, linkedBy: USER_A });
}

function makeCase(userId: string, caseId: string) {
  return makeModerationCase({
    guildId: GUILD_ID,
    caseId,
    userId,
    executorId: USER_A,
  });
}

function makeClient(
  userId: string,
  fetchUser: () => Promise<unknown> = () =>
    Promise.resolve({
      id: userId,
      username: "user",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
    }),
): Client {
  return {
    guilds: {
      cache: {
        get: mock(() => ({
          members: { cache: { get: mock(() => null) } },
        })),
      },
    },
    users: {
      fetch: mock(fetchUser),
    },
  } as unknown as Client;
}

describe("HistoryUserService", () => {
  let modLogRepository: ModLogRepository;
  let altAccountRepository: AltAccountRepository;
  let service: HistoryUserService;

  beforeEach(() => {
    modLogRepository = {
      findByUserIdNotPending: mock(() => Promise.resolve(Ok([]))),
      findByUserIdsNotPending: mock(() => Promise.resolve(Ok([]))),
    } as unknown as ModLogRepository;

    altAccountRepository = {
      findIdentityByUserId: mock(() => Promise.resolve(Ok(null))),
    } as unknown as AltAccountRepository;

    service = new HistoryUserService(
      makeClient(USER_A),
      modLogRepository,
      altAccountRepository,
      testLogger,
    );
  });

  it("queries only the target user when there is no linked identity", async () => {
    const result = await service.getUserHistory(GUILD_ID, USER_A);

    expect(result.ok).toBe(true);
    expect(modLogRepository.findByUserIdsNotPending).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A],
    );
    if (result.ok) {
      expect(result.val.linkedIdentity).toBeNull();
    }
  });

  it("merges history across every member when the identity has more than one account", async () => {
    const identity = makeIdentity([USER_A, USER_B]);
    altAccountRepository.findIdentityByUserId = mock(() =>
      Promise.resolve(Ok(identity)),
    );
    modLogRepository.findByUserIdsNotPending = mock(() =>
      Promise.resolve(
        Ok([makeCase(USER_A, "1"), makeCase(USER_B, "2")]),
      ),
    );

    const result = await service.getUserHistory(GUILD_ID, USER_A);

    expect(result.ok).toBe(true);
    expect(modLogRepository.findByUserIdsNotPending).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A, USER_B],
    );
    if (result.ok) {
      expect(result.val.linkedIdentity).toBe(identity);
      expect(result.val.totalCases).toBe(2);
    }
  });

  it("does not treat a single-member identity as linked", async () => {
    altAccountRepository.findIdentityByUserId = mock(() =>
      Promise.resolve(Ok(makeIdentity([USER_A]))),
    );

    const result = await service.getUserHistory(GUILD_ID, USER_A);

    expect(result.ok).toBe(true);
    expect(modLogRepository.findByUserIdsNotPending).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A],
    );
    if (result.ok) {
      expect(result.val.linkedIdentity).toBeNull();
    }
  });

  it("falls back to single-account history when the identity lookup fails", async () => {
    altAccountRepository.findIdentityByUserId = mock(() =>
      Promise.resolve(Err("db error")),
    );

    const result = await service.getUserHistory(GUILD_ID, USER_A);

    expect(result.ok).toBe(true);
    expect(modLogRepository.findByUserIdsNotPending).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A],
    );
    if (result.ok) {
      expect(result.val.linkedIdentity).toBeNull();
    }
  });

  it("returns an error when the Discord user fetch fails", async () => {
    service = new HistoryUserService(
      makeClient(USER_A, () => Promise.reject(new Error("unknown user"))),
      modLogRepository,
      altAccountRepository,
      testLogger,
    );

    const result = await service.getUserHistory(GUILD_ID, USER_A);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.val).toContain("Failed to fetch user");
    }
    expect(modLogRepository.findByUserIdsNotPending).not.toHaveBeenCalled();
  });
});
