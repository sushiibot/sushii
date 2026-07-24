import { beforeEach, describe, expect, it, mock } from "bun:test";
import { pino } from "pino";
import { Ok } from "ts-results";

import { makeAltIdentity } from "@/test/fixtures/altIdentity";

import type { AltAccountRepository } from "../domain/repositories/AltAccountRepository";
import { NICKNAME_MAX_LENGTH, SetNicknameService } from "./SetNicknameService";

const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";

function makeIdentity(nickname: string | null) {
  return makeAltIdentity({ guildId: GUILD_ID, nickname });
}

describe("SetNicknameService", () => {
  let mockRepository: AltAccountRepository;
  let service: SetNicknameService;

  beforeEach(() => {
    mockRepository = {
      link: mock(() => {
        throw new Error("not used");
      }),
      findIdentityByUserId: mock(() => Promise.resolve(Ok(makeIdentity(null)))),
      findIdentityById: mock(() => Promise.resolve(Ok(makeIdentity("DramaKid alts")))),
      removeMember: mock(() => {
        throw new Error("not used");
      }),
      setNickname: mock(() => Promise.resolve(Ok.EMPTY)),
      listIdentities: mock(() => Promise.resolve(Ok([]))),
      countIdentities: mock(() => Promise.resolve(Ok(0))),
    };

    service = new SetNicknameService(mockRepository, pino({ level: "silent" }));
  });

  it("sets a nickname", async () => {
    const result = await service.setNickname(GUILD_ID, USER_ID, "DramaKid alts");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.kind).toBe("updated");
    }
    expect(mockRepository.setNickname).toHaveBeenCalledWith(
      GUILD_ID,
      1,
      "DramaKid alts",
    );
  });

  it("clears a nickname when passed null", async () => {
    mockRepository.findIdentityByUserId = mock(() =>
      Promise.resolve(Ok(makeIdentity("Old Name"))),
    );

    const result = await service.setNickname(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    expect(mockRepository.setNickname).toHaveBeenCalledWith(GUILD_ID, 1, null);
  });

  it("rejects a nickname longer than the max length", async () => {
    const result = await service.setNickname(
      GUILD_ID,
      USER_ID,
      "a".repeat(NICKNAME_MAX_LENGTH + 1),
    );

    expect(result.err).toBe(true);
    expect(mockRepository.setNickname).not.toHaveBeenCalled();
  });

  it("accepts a nickname exactly at the max length", async () => {
    const result = await service.setNickname(
      GUILD_ID,
      USER_ID,
      "a".repeat(NICKNAME_MAX_LENGTH),
    );

    expect(result.ok).toBe(true);
  });

  it("returns 'noIdentity' when the account has no identity", async () => {
    mockRepository.findIdentityByUserId = mock(() => Promise.resolve(Ok(null)));

    const result = await service.setNickname(GUILD_ID, USER_ID, "Nickname");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.kind).toBe("noIdentity");
    }
    expect(mockRepository.setNickname).not.toHaveBeenCalled();
  });

  describe("setNicknameByIdentityId", () => {
    it("returns the refreshed identity on success", async () => {
      const result = await service.setNicknameByIdentityId(
        GUILD_ID,
        1,
        "DramaKid alts",
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.identity.nickname).toBe("DramaKid alts");
      }
      expect(mockRepository.setNickname).toHaveBeenCalledWith(
        GUILD_ID,
        1,
        "DramaKid alts",
      );
    });

    it("rejects a nickname longer than the max length", async () => {
      const result = await service.setNicknameByIdentityId(
        GUILD_ID,
        1,
        "a".repeat(NICKNAME_MAX_LENGTH + 1),
      );

      expect(result.err).toBe(true);
      expect(mockRepository.setNickname).not.toHaveBeenCalled();
    });
  });
});
