import { beforeEach, describe, expect, it, mock } from "bun:test";
import { pino } from "pino";
import { Ok } from "ts-results";

import { makeAltIdentity } from "@/test/fixtures/altIdentity";

import type {
  AltAccountRepository,
  MultiLinkOutcome,
} from "../domain/repositories/AltAccountRepository";
import { LinkAccountsService, MAX_LINKED_ACCOUNTS } from "./LinkAccountsService";

const GUILD_ID = "111111111111111111";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";
const USER_C = "555555555555555555";
const BOT_ID = "666666666666666666";
const LINKED_BY = "444444444444444444";

function makeIdentity(id: number) {
  return makeAltIdentity({ id, guildId: GUILD_ID });
}

function makeOutcome(overrides: Partial<MultiLinkOutcome> = {}): MultiLinkOutcome {
  return {
    identity: makeIdentity(1),
    identityCreated: true,
    addedUserIds: [USER_A, USER_B],
    alreadyLinkedUserIds: [],
    mergedIdentityIds: [],
    keptNickname: null,
    adoptedNickname: null,
    discardedNicknames: [],
    ...overrides,
  };
}

function request(
  overrides: Partial<Parameters<LinkAccountsService["link"]>[0]> = {},
) {
  return {
    guildId: GUILD_ID,
    primary: [
      { id: USER_A, isBot: false },
      { id: USER_B, isBot: false },
    ] as [{ id: string; isBot: boolean }, { id: string; isBot: boolean }],
    additional: [],
    linkedBy: LINKED_BY,
    reason: null,
    ...overrides,
  };
}

describe("LinkAccountsService", () => {
  let mockRepository: AltAccountRepository;
  let service: LinkAccountsService;

  beforeEach(() => {
    mockRepository = {
      linkMany: mock(() => Promise.resolve(Ok(makeOutcome()))),
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
      request({
        primary: [
          { id: USER_A, isBot: false },
          { id: USER_A, isBot: false },
        ],
      }),
    );

    expect(result.err).toBe(true);
    expect(mockRepository.linkMany).not.toHaveBeenCalled();
  });

  it("rejects linking when either required account is a bot", async () => {
    const result = await service.link(
      request({
        primary: [
          { id: USER_A, isBot: true },
          { id: USER_B, isBot: false },
        ],
      }),
    );

    expect(result.err).toBe(true);
    expect(result.val).toBe("Bot accounts can't be linked.");
    expect(mockRepository.linkMany).not.toHaveBeenCalled();
  });

  it("passes every deduplicated account through to the repository", async () => {
    const result = await service.link(
      request({
        additional: [{ id: USER_C, isBot: false }],
        reason: "suspected alt",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockRepository.linkMany).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A, USER_B, USER_C],
      LINKED_BY,
      "suspected alt",
    );
  });

  it("drops bots from additional accounts and reports them as skipped", async () => {
    const result = await service.link(
      request({
        additional: [
          { id: BOT_ID, isBot: true },
          { id: USER_C, isBot: false },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.skippedBotIds).toEqual([BOT_ID]);
    }
    expect(mockRepository.linkMany).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A, USER_B, USER_C],
      LINKED_BY,
      null,
    );
  });

  it("collapses an additional account that repeats a required one", async () => {
    await service.link(
      request({ additional: [{ id: USER_A, isBot: false }] }),
    );

    expect(mockRepository.linkMany).toHaveBeenCalledWith(
      GUILD_ID,
      [USER_A, USER_B],
      LINKED_BY,
      null,
    );
  });

  it("rejects more than the maximum number of accounts", async () => {
    const additional = Array.from({ length: MAX_LINKED_ACCOUNTS }, (_, i) => ({
      id: `7777777777777${String(i).padStart(5, "0")}`,
      isBot: false,
    }));

    const result = await service.link(request({ additional }));

    expect(result.err).toBe(true);
    expect(mockRepository.linkMany).not.toHaveBeenCalled();
  });

  it("passes through the repository outcome fields", async () => {
    mockRepository.linkMany = mock(() =>
      Promise.resolve(
        Ok(
          makeOutcome({
            identityCreated: false,
            addedUserIds: [USER_C],
            alreadyLinkedUserIds: [USER_A, USER_B],
            mergedIdentityIds: [7, 9],
            keptNickname: "DramaKid alts",
            discardedNicknames: ["suspected raiders"],
          }),
        ),
      ),
    );

    const result = await service.link(
      request({ additional: [{ id: USER_C, isBot: false }] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.identityCreated).toBe(false);
      expect(result.val.addedUserIds).toEqual([USER_C]);
      expect(result.val.mergedIdentityIds).toEqual([7, 9]);
      expect(result.val.keptNickname).toBe("DramaKid alts");
      expect(result.val.discardedNicknames).toEqual(["suspected raiders"]);
      expect(result.val.skippedBotIds).toEqual([]);
    }
  });
});
