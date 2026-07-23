import { beforeEach, describe, expect, it, mock } from "bun:test";
import { pino } from "pino";
import { Ok } from "ts-results";

import type { AltAccountRepository, RemoveMemberOutcome } from "../domain/repositories/AltAccountRepository";
import { UnlinkAccountService } from "./UnlinkAccountService";

const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";

describe("UnlinkAccountService", () => {
  let mockRepository: AltAccountRepository;
  let service: UnlinkAccountService;

  beforeEach(() => {
    mockRepository = {
      link: mock(() => {
        throw new Error("not used");
      }),
      findIdentityByUserId: mock(() => Promise.resolve(Ok(null))),
      findIdentityById: mock(() => Promise.resolve(Ok(null))),
      removeMember: mock(() =>
        Promise.resolve(Ok<RemoveMemberOutcome>({ kind: "notLinked" })),
      ),
      setNickname: mock(() => Promise.resolve(Ok.EMPTY)),
      listIdentities: mock(() => Promise.resolve(Ok([]))),
      countIdentities: mock(() => Promise.resolve(Ok(0))),
    };

    service = new UnlinkAccountService(mockRepository, pino({ level: "silent" }));
  });

  it("returns 'notLinked' as a non-error result when the account has no identity", async () => {
    const result = await service.unlink(GUILD_ID, USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val.kind).toBe("notLinked");
    }
  });

  it("returns 'removed' without deleting the identity for a mid-group removal", async () => {
    mockRepository.removeMember = mock(() =>
      Promise.resolve(
        Ok<RemoveMemberOutcome>({ kind: "removed", identityDeleted: false }),
      ),
    );

    const result = await service.unlink(GUILD_ID, USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok && result.val.kind === "removed") {
      expect(result.val.identityDeleted).toBe(false);
    }
  });

  it("returns 'removed' with identityDeleted=true for a last-member removal", async () => {
    mockRepository.removeMember = mock(() =>
      Promise.resolve(
        Ok<RemoveMemberOutcome>({ kind: "removed", identityDeleted: true }),
      ),
    );

    const result = await service.unlink(GUILD_ID, USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok && result.val.kind === "removed") {
      expect(result.val.identityDeleted).toBe(true);
    }
  });
});
