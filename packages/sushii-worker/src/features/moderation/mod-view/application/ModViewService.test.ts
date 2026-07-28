import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client, GuildMember } from "discord.js";
import { GuildFeature } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { AltAccountRepository } from "@/features/alt-accounts/domain/repositories";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";

import type { HistoryUserService } from "../../cases/application/HistoryUserService";
import type { LookupUserService } from "../../cases/application/LookupUserService";
import type { NamesUserService } from "../../cases/application/NamesUserService";
import { TempBan } from "../../shared/domain/entities/TempBan";
import type { TempBanRepository } from "../../shared/domain/repositories/TempBanRepository";
import { TimeoutDetectionService } from "../../shared/domain/services/TimeoutDetectionService";
import type { UserInfo } from "../../shared/domain/types/UserInfo";
import { ModViewService } from "./ModViewService";

const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";

const testLogger = pino({ level: "silent" });

const userInfo: UserInfo = {
  id: USER_ID,
  username: "target",
  avatarURL: "https://example.com/avatar.png",
  joinedAt: null,
  isBot: false,
};

/**
 * The member cache is deliberately empty on every guild this builds: the
 * service must never consult it, so a cache that could satisfy a lookup would
 * hide a regression back to `guild.members.cache.get`.
 */
function makeClient(opts?: { guild?: { public: boolean } | null }): Client {
  const guildFound = opts?.guild !== null;
  const public_ = opts?.guild?.public ?? false;

  return {
    guilds: {
      cache: {
        get: mock(() =>
          guildFound
            ? {
                id: GUILD_ID,
                features: public_ ? [GuildFeature.Discoverable] : [],
                memberCount: public_ ? 5000 : 10,
                members: {
                  cache: {
                    get: mock(() => undefined),
                  },
                },
              }
            : undefined,
        ),
      },
    },
  } as unknown as Client;
}

/** The caller-resolved member — what presentation passes into `getModView`. */
function makeMember(communicationDisabledUntil: Date | null): GuildMember {
  return {
    user: { id: USER_ID },
    communicationDisabledUntil,
  } as unknown as GuildMember;
}

describe("ModViewService", () => {
  let historyUserService: HistoryUserService;
  let lookupUserService: LookupUserService;
  let namesUserService: NamesUserService;
  let altAccountRepository: AltAccountRepository;
  let tempBanRepository: TempBanRepository;
  const timeoutDetectionService = new TimeoutDetectionService();

  beforeEach(() => {
    historyUserService = {
      getUserHistory: mock(() =>
        Promise.resolve(
          Ok({
            userInfo,
            moderationHistory: [],
            totalCases: 0,
            linkedIdentity: null,
          }),
        ),
      ),
    } as unknown as HistoryUserService;

    lookupUserService = {
      lookupUser: mock(() =>
        Promise.resolve(
          Ok({
            userInfo,
            crossServerBans: [],
            currentGuildLookupOptIn: true,
          }),
        ),
      ),
    } as unknown as LookupUserService;

    namesUserService = {
      getNames: mock(() =>
        Promise.resolve(
          Ok({ userInfo, history: [], eligibilityDenied: false }),
        ),
      ),
    } as unknown as NamesUserService;

    altAccountRepository = {
      findIdentityByUserId: mock(() => Promise.resolve(Ok(null))),
    } as unknown as AltAccountRepository;

    tempBanRepository = {
      findByGuildAndUserId: mock(() => Promise.resolve(Ok(null))),
    } as unknown as TempBanRepository;
  });

  function makeService(client: Client) {
    return new ModViewService(
      client,
      historyUserService,
      lookupUserService,
      namesUserService,
      altAccountRepository,
      tempBanRepository,
      timeoutDetectionService,
      testLogger,
    );
  }

  it("resolves without throwing for a target with no data at all", async () => {
    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.history.totalCases).toBe(0);
    expect(result.val.identity).toBeNull();
    // Non-public guild: LookupUserService is never called and lookup is null.
    expect(lookupUserService.lookupUser).not.toHaveBeenCalled();
    expect(result.val.lookup).toBeNull();
  });

  it("calls LookupUserService only when the guild is public", async () => {
    const service = makeService(makeClient({ guild: { public: true } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    expect(lookupUserService.lookupUser).toHaveBeenCalledWith(
      GUILD_ID,
      USER_ID,
    );
  });

  it("propagates a thrown repository error rather than degrading the view", async () => {
    altAccountRepository = {
      findIdentityByUserId: mock(() =>
        Promise.reject(new Error("db connection lost")),
      ),
    } as unknown as AltAccountRepository;

    const service = makeService(makeClient({ guild: { public: false } }));

    await expect(service.getModView(GUILD_ID, USER_ID, null)).rejects.toThrow(
      "db connection lost",
    );
  });

  it("propagates an Err result from a sub-service as the whole view's Err", async () => {
    historyUserService = {
      getUserHistory: mock(() =>
        Promise.resolve(Err("Failed to get moderation history")),
      ),
    } as unknown as HistoryUserService;

    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.val).toBe("Failed to get moderation history");
  });

  it("passes eligibilityDenied through as a successful Ok payload, not an Err", async () => {
    namesUserService = {
      getNames: mock(() =>
        Promise.resolve(Ok({ userInfo, history: [], eligibilityDenied: true })),
      ),
    } as unknown as NamesUserService;

    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.names.eligibilityDenied).toBe(true);
  });

  it("distinguishes history.linkedIdentity (2+ members) from identity (any size)", async () => {
    const identity = makeAltIdentity({
      guildId: GUILD_ID,
      memberIds: [USER_ID],
      linkedBy: USER_ID,
    });

    altAccountRepository = {
      findIdentityByUserId: mock(() => Promise.resolve(Ok(identity))),
    } as unknown as AltAccountRepository;

    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Single-member identity: HistoryUserService's own field stays null...
    expect(result.val.history.linkedIdentity).toBeNull();
    // ...but ModViewService's `identity` still carries it for the Alts tab.
    expect(result.val.identity).toEqual(identity);
  });

  it("fails the whole view when the guild cannot be resolved", async () => {
    const service = makeService(makeClient({ guild: null }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.val).toBe("Guild not found");
  });

  it("reports standing as a live timeout when communicationDisabledUntil is in the future", async () => {
    const endsAt = new Date(Date.now() + 60_000);
    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(
      GUILD_ID,
      USER_ID,
      makeMember(endsAt),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing).toEqual({ kind: "timeout", endsAt });
  });

  it("reports a live timeout from the passed member even when the member cache is empty", async () => {
    // The regression this guards: reading `guild.members.cache.get` returned
    // undefined on a cache miss, so a live timeout rendered as no standing
    // line at all — indistinguishable from "not restricted".
    const endsAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const client = makeClient({ guild: { public: false } });

    const result = await makeService(client).getModView(
      GUILD_ID,
      USER_ID,
      makeMember(endsAt),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing).toEqual({ kind: "timeout", endsAt });
    expect(
      client.guilds.cache.get(GUILD_ID)?.members.cache.get(USER_ID),
    ).toBeUndefined();
  });

  it("reports standing as null when the timeout has already elapsed", async () => {
    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(
      GUILD_ID,
      USER_ID,
      makeMember(new Date(Date.now() - 60_000)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing).toBeNull();
  });

  it("reports standing as an active temp ban when the ban has not yet expired", async () => {
    const endsAt = new Date(Date.now() + 60_000);
    tempBanRepository = {
      findByGuildAndUserId: mock(() =>
        Promise.resolve(
          Ok(TempBan.fromDatabase(USER_ID, GUILD_ID, endsAt, new Date())),
        ),
      ),
    } as unknown as TempBanRepository;

    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing).toEqual({ kind: "tempban", endsAt });
  });

  it("reports standing as null when the temp ban has already expired", async () => {
    tempBanRepository = {
      findByGuildAndUserId: mock(() =>
        Promise.resolve(
          Ok(
            TempBan.fromDatabase(
              USER_ID,
              GUILD_ID,
              new Date(Date.now() - 60_000),
              new Date(Date.now() - 120_000),
            ),
          ),
        ),
      ),
    } as unknown as TempBanRepository;

    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing).toBeNull();
  });

  it("reports standing as null when nothing is currently in force", async () => {
    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing).toBeNull();
  });

  it("does not throw when the target is not a guild member", async () => {
    tempBanRepository = {
      findByGuildAndUserId: mock(() =>
        Promise.resolve(
          Ok(
            TempBan.fromDatabase(
              USER_ID,
              GUILD_ID,
              new Date(Date.now() + 60_000),
              new Date(),
            ),
          ),
        ),
      ),
    } as unknown as TempBanRepository;

    // `null` member => the target has left or never joined the guild.
    const service = makeService(makeClient({ guild: { public: false } }));

    const result = await service.getModView(GUILD_ID, USER_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.val.standing?.kind).toBe("tempban");
  });
});
