import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Guild, GuildAuditLogsEntry } from "discord.js";
import { AuditLogEvent as DiscordAuditLogEvent } from "discord.js";
import pino from "pino";
import { Ok } from "ts-results";

import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import { ActionType } from "../../shared/domain/value-objects/ActionType";
import { Reason } from "../../shared/domain/value-objects/Reason";
import { AuditLogService } from "./AuditLogService";
import type { ModLogPostingService } from "./ModLogPostingService";
import type { NativeTimeoutDMService } from "./NativeTimeoutDMService";

const GUILD = "187450744427773963";
const TARGET = "912345678901234567";
const MOD = "150443906511667200";
const SETTER = "238381427315195904";
const LOG_CHANNEL = "1029384756102938400";
const POSTED = "1029384756102938499";
const SET_AT = new Date("2026-10-27T11:00:30.000Z");

function pendingRow(): ModerationCase {
  return new ModerationCase(
    GUILD,
    "4822",
    ActionType.Ban,
    new Date("2026-10-27T11:00:00.000Z"),
    TARGET,
    "spambot",
    MOD,
    null,
    null,
    [],
    { channelId: "1", messageId: "2" },
  );
}

function editedRow(): ModerationCase {
  return pendingRow()
    .withReason(Reason.create("Set while pending").unwrap())
    .withReasonSetBy(SETTER, SET_AT)
    .withDmDeleted();
}

describe("AuditLogService", () => {
  let findById: ReturnType<typeof mock>;
  let postModLogMessage: ReturnType<typeof mock>;
  let refresh: ReturnType<typeof mock>;
  let service: AuditLogService;

  const entry = {
    action: DiscordAuditLogEvent.MemberBanAdd,
    targetId: TARGET,
    targetType: "User",
    executorId: MOD,
    reason: null,
  } as unknown as GuildAuditLogsEntry;

  const guild = {
    id: GUILD,
    client: { users: { fetch: mock(async () => ({ id: TARGET })) } },
  } as unknown as Guild;

  beforeEach(() => {
    findById = mock(async () => editedRow());
    postModLogMessage = mock(async () => Ok(POSTED));
    refresh = mock(async () => "updated");

    const modLogRepository = {
      findPendingCase: mock(async (_g: string, _u: string, type: ActionType) =>
        type === ActionType.Ban ? pendingRow().withPending(true) : null,
      ),
      // markAsNotPending returns the row as it was before the edit.
      markAsNotPending: mock(async () => pendingRow()),
      findById,
      updateMessageId: mock(async () => undefined),
    } as unknown as ModLogRepository;

    service = new AuditLogService(
      modLogRepository,
      {} as NativeTimeoutDMService,
      { postModLogMessage } as unknown as ModLogPostingService,
      {
        findByGuildId: mock(async () => ({
          loggingSettings: { modLogChannel: LOG_CHANNEL, modLogEnabled: true },
        })),
      } as unknown as GuildConfigRepository,
      { reactToRecentAlerts: mock(async () => undefined) } as never,
      { updateSpamAlert: mock(async () => undefined) } as never,
      pino({ level: "silent" }),
      { isSuppressed: () => false } as never,
      { refresh },
    );
  });

  test("posts the current row: a reason and DM deletion made while pending show up", async () => {
    const result = await service.handleAuditLogEntry(entry, guild);

    expect(result.ok).toBe(true);
    expect(findById).toHaveBeenCalledWith(GUILD, "4822");
    const posted = (
      postModLogMessage.mock.calls[0] as unknown as [unknown, ModerationCase]
    )[1];
    expect(posted.reason?.value).toBe("Set while pending");
    expect(posted.reasonSetBy).toBe(SETTER);
    expect(posted.reasonSetAt).toEqual(SET_AT);
    expect(posted.dmDeleted).toBe(true);
    expect(posted.executorId).toBe(MOD);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("re-renders once when the row changed while posting", async () => {
    findById
      .mockResolvedValueOnce(pendingRow())
      .mockResolvedValueOnce(editedRow());

    await service.handleAuditLogEntry(entry, guild);

    expect(refresh).toHaveBeenCalledTimes(1);
    const [refreshed] = refresh.mock.calls[0] as unknown as [ModerationCase];
    expect(refreshed.reason?.value).toBe("Set while pending");
  });
});
