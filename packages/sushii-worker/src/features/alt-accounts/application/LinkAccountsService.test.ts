import { beforeEach, describe, expect, it, mock } from "bun:test";
import { pino } from "pino";
import { Ok } from "ts-results";

import type { AltIdentity } from "../domain/entities/AltIdentity";
import type { AltAccountRepository, LinkOutcome } from "../domain/repositories/AltAccountRepository";
import type { AltIdentityWithMembers } from "../domain/types/AltIdentityWithMembers";
import { LinkAccountsService } from "./LinkAccountsService";

const GUILD_ID = "111111111111111111";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";
const LINKED_BY = "444444444444444444";

function makeIdentity(id: number): AltIdentityWithMembers {
  return {
    identity: {
      id,
      guildId: GUILD_ID,
      nickname: null,
      createdAt: new Date(),
    } as AltIdentity,
    members: [],
  };
}

describe("LinkAccountsService", () => {
  let mockRepository: AltAccountRepository;
  let service: LinkAccountsService;

  beforeEach(() => {
    mockRepository = {
      link: mock(() =>
        Promise.resolve(
          Ok<LinkOutcome>({
            kind: "created",
            identity: makeIdentity(1),
          }),
        ),
      ),
      findIdentityByUserId: mock(() => Promise.resolve(Ok(null))),
      findIdentityById: mock(() => Promise.resolve(Ok(null))),
      removeMember: mock(() => Promise.resolve(Ok({ kind: "notLinked" as const }))),
      setNickname: mock(() => Promise.resolve(Ok.EMPTY)),
      listIdentities: mock(() => Promise.resolve(Ok([]))),
      countIdentities: mock(() => Promise.resolve(Ok(0))),
    };

    service = new LinkAccountsService(mockRepository, pino({ level: "silent" }));
  });

  it("rejects linking an account to itself", async () => {
    const result = await service.link(
      GUILD_ID,
      { id: USER_A, isBot: false },
      { id: USER_A, isBot: false },
      LINKED_BY,
      null,
    );

    expect(result.err).toBe(true);
    expect(mockRepository.link).not.toHaveBeenCalled();
  });

  it("rejects linking when either account is a bot", async () => {
    const result = await service.link(
      GUILD_ID,
      { id: USER_A, isBot: true },
      { id: USER_B, isBot: false },
      LINKED_BY,
      null,
    );

    expect(result.err).toBe(true);
    expect(mockRepository.link).not.toHaveBeenCalled();
  });

  it("passes through the 'created' outcome", async () => {
    mockRepository.link = mock(() =>
      Promise.resolve(
        Ok<LinkOutcome>({ kind: "created", identity: makeIdentity(1) }),
      ),
    );

    const result = await service.link(
      GUILD_ID,
      { id: USER_A, isBot: false },
      { id: USER_B, isBot: false },
      LINKED_BY,
      "suspected alt",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.kind).toBe("created");
    }
    expect(mockRepository.link).toHaveBeenCalledWith(
      GUILD_ID,
      USER_A,
      USER_B,
      LINKED_BY,
      "suspected alt",
    );
  });

  it("passes through the 'added' outcome", async () => {
    mockRepository.link = mock(() =>
      Promise.resolve(
        Ok<LinkOutcome>({
          kind: "added",
          identity: makeIdentity(1),
          addedUserId: USER_B,
        }),
      ),
    );

    const result = await service.link(
      GUILD_ID,
      { id: USER_A, isBot: false },
      { id: USER_B, isBot: false },
      LINKED_BY,
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.val.kind === "added") {
      expect(result.val.addedUserId).toBe(USER_B);
    }
  });

  it("passes through the 'alreadyLinked' outcome", async () => {
    mockRepository.link = mock(() =>
      Promise.resolve(
        Ok<LinkOutcome>({
          kind: "alreadyLinked",
          identity: makeIdentity(1),
        }),
      ),
    );

    const result = await service.link(
      GUILD_ID,
      { id: USER_A, isBot: false },
      { id: USER_B, isBot: false },
      LINKED_BY,
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.kind).toBe("alreadyLinked");
    }
  });

  it("passes through the 'merged' outcome with both nicknames", async () => {
    mockRepository.link = mock(() =>
      Promise.resolve(
        Ok<LinkOutcome>({
          kind: "merged",
          identity: makeIdentity(1),
          keptNickname: "DramaKid alts",
          discardedNickname: "suspected raiders",
        }),
      ),
    );

    const result = await service.link(
      GUILD_ID,
      { id: USER_A, isBot: false },
      { id: USER_B, isBot: false },
      LINKED_BY,
      null,
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.val.kind === "merged") {
      expect(result.val.keptNickname).toBe("DramaKid alts");
      expect(result.val.discardedNickname).toBe("suspected raiders");
    }
  });
});
