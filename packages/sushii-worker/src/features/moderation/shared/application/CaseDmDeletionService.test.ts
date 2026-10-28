import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";

import type { DMResult } from "../domain/entities/ModerationCase";
import { ModerationCase } from "../domain/entities/ModerationCase";
import { ActionType } from "../domain/value-objects/ActionType";
import { CaseDmDeletionService } from "./CaseDmDeletionService";

const GUILD = "187450744427773963";
const MOD = "150443906511667200";
const LIVE: DMResult = {
  channelId: "1029384756102938400",
  messageId: "1029384756102938401",
};

function makeCase(
  caseId: string,
  dmResult: DMResult | null,
  dmDeleted = false,
): ModerationCase {
  const base = new ModerationCase(
    GUILD,
    caseId,
    ActionType.Ban,
    new Date(),
    "912345678901234567",
    "spambot",
    MOD,
    null,
    "1029384756102938499",
    [],
    dmResult,
  );
  return dmDeleted ? base.withDmDeleted() : base;
}

function discordError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { message: "x", code },
    code,
    404,
    "DELETE",
    "/channels/1/messages/2",
    {},
  );
}

describe("CaseDmDeletionService", () => {
  let findByIds: ReturnType<typeof mock>;
  let markDmDeleted: ReturnType<typeof mock>;
  let deleteModerationDM: ReturnType<typeof mock>;
  let loadEntry: ReturnType<typeof mock>;
  let refreshEntry: ReturnType<typeof mock>;
  let recordModLogEdit: ReturnType<typeof mock>;
  let service: CaseDmDeletionService;

  beforeEach(() => {
    findByIds = mock(async () => [] as ModerationCase[]);
    markDmDeleted = mock(async () => undefined);
    deleteModerationDM = mock(async () => undefined);
    loadEntry = mock(async (moderationCase: ModerationCase) => ({
      moderationCase,
      message: {},
      missing: null,
    }));
    refreshEntry = mock(async () => "updated");
    recordModLogEdit = mock();
    service = new CaseDmDeletionService(
      {} as Client,
      { findByIds, markDmDeleted },
      { deleteModerationDM },
      { loadEntry, refreshEntry } as never,
      pino({ level: "silent" }),
      { recordModLogEdit },
    );
  });

  test("deletes each DM, marks it and re-renders the mod log entry", async () => {
    findByIds.mockResolvedValueOnce([makeCase("1", LIVE), makeCase("2", LIVE)]);

    const outcomes = await service.deleteDms(GUILD, ["1", "2"], MOD);

    expect(deleteModerationDM).toHaveBeenCalledTimes(2);
    expect(deleteModerationDM).toHaveBeenCalledWith(
      {},
      LIVE.channelId,
      LIVE.messageId,
    );
    expect(markDmDeleted).toHaveBeenCalledWith(
      GUILD,
      "1",
      MOD,
      expect.any(Date),
    );
    expect(markDmDeleted).toHaveBeenCalledWith(
      GUILD,
      "2",
      MOD,
      expect.any(Date),
    );
    expect(outcomes.map((o) => [o.caseId, o.result, o.modLog])).toEqual([
      ["1", "deleted", "updated"],
      ["2", "deleted", "updated"],
    ]);
    expect(outcomes[0]?.moderationCase?.dmDeleted).toBe(true);

    const [, rendered] = refreshEntry.mock.calls[0] as unknown as [
      unknown,
      ModerationCase,
    ];
    expect(rendered.dmDeleted).toBe(true);
    expect(rendered.dmDeletedBy).toBe(MOD);
    expect(rendered.dmDeletedAt).toBeInstanceOf(Date);
  });

  test("reports missing, DM-less and already deleted cases without touching them", async () => {
    findByIds.mockResolvedValueOnce([
      makeCase("2", null),
      makeCase("3", LIVE, true),
    ]);

    const outcomes = await service.deleteDms(GUILD, ["1", "2", "3"], MOD);

    expect(outcomes.map((o) => o.result)).toEqual([
      "not_found",
      "no_dm",
      "already_deleted",
    ]);
    expect(deleteModerationDM).not.toHaveBeenCalled();
    expect(markDmDeleted).not.toHaveBeenCalled();
    expect(refreshEntry).not.toHaveBeenCalled();
  });

  test("a legacy entry that shows the DM as deleted is never deleted again", async () => {
    findByIds.mockResolvedValueOnce([makeCase("1", LIVE)]);
    loadEntry.mockImplementationOnce(
      async (moderationCase: ModerationCase) => ({
        moderationCase: moderationCase.withDmDeleted(),
        message: {},
        missing: null,
      }),
    );

    const [outcome] = await service.deleteDms(GUILD, ["1"], MOD);

    expect(outcome?.result).toBe("already_deleted");
    expect(deleteModerationDM).not.toHaveBeenCalled();
  });

  test("a DM that's already gone on Discord still counts as deleted", async () => {
    findByIds.mockResolvedValueOnce([makeCase("1", LIVE)]);
    deleteModerationDM.mockRejectedValueOnce(
      discordError(RESTJSONErrorCodes.UnknownMessage),
    );

    const [outcome] = await service.deleteDms(GUILD, ["1"], MOD);

    expect(outcome?.result).toBe("deleted");
    expect(markDmDeleted).toHaveBeenCalledWith(
      GUILD,
      "1",
      MOD,
      expect.any(Date),
    );
  });

  test("a refused delete leaves the case unmarked and the others continue", async () => {
    findByIds.mockResolvedValueOnce([makeCase("1", LIVE), makeCase("2", LIVE)]);
    deleteModerationDM.mockRejectedValueOnce(new Error("Service Unavailable"));

    const outcomes = await service.deleteDms(GUILD, ["1", "2"], MOD);

    expect(outcomes.map((o) => o.result)).toEqual(["failed", "deleted"]);
    expect(recordModLogEdit.mock.calls).toEqual([
      ["dm_delete", "failed"],
      ["dm_delete", "ok"],
    ]);
    expect(outcomes[0]?.moderationCase?.dmDeleted).toBe(false);
    expect(markDmDeleted).toHaveBeenCalledTimes(1);
    expect(markDmDeleted).toHaveBeenCalledWith(
      GUILD,
      "2",
      MOD,
      expect.any(Date),
    );
  });

  test("skips the refresh for cases the caller re-renders", async () => {
    findByIds.mockResolvedValueOnce([makeCase("1", LIVE)]);

    const [outcome] = await service.deleteDms(GUILD, ["1"], MOD, {
      skipModLogRefreshFor: ["1"],
    });

    expect(outcome?.result).toBe("deleted");
    expect(outcome?.modLog).toBeNull();
    expect(loadEntry).not.toHaveBeenCalled();
    expect(refreshEntry).not.toHaveBeenCalled();
  });
});
