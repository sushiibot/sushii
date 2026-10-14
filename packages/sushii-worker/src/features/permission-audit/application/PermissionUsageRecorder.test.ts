import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuditLogEvent } from "discord.js";
import pino from "pino";

import type { PermissionUsageRepository } from "../domain/PermissionUsageRepository";
import type { AuditLogEntryInput } from "../domain/detectors/AuditLogUsageDetector";
import { AuditLogUsageDetector } from "../domain/detectors/AuditLogUsageDetector";
import { MessageUsageDetector } from "../domain/detectors/MessageUsageDetector";
import { PermissionUsageRecorder } from "./PermissionUsageRecorder";

const GUILD_ID = "200000000000000002";
const MOD_ID = "300000000000000003";

function banEntry(): AuditLogEntryInput {
  return {
    guildId: GUILD_ID,
    action: AuditLogEvent.MemberBanAdd,
    executorId: MOD_ID,
    targetId: "400000000000000004",
    channelId: null,
    changeKeys: [],
    occurredAt: new Date("2026-10-01T00:00:00Z"),
  };
}

describe("PermissionUsageRecorder", () => {
  let repository: {
    record: ReturnType<typeof mock>;
    ensureTrackingStarted: ReturnType<typeof mock>;
    deleteLastUsedBefore: ReturnType<typeof mock>;
    deleteGuild: ReturnType<typeof mock>;
  };
  let recorder: PermissionUsageRecorder;

  beforeEach(() => {
    repository = {
      record: mock(() => Promise.resolve()),
      ensureTrackingStarted: mock(() => Promise.resolve()),
      deleteLastUsedBefore: mock(() => Promise.resolve(0)),
      deleteGuild: mock(() => Promise.resolve()),
    };
    recorder = new PermissionUsageRecorder(
      repository as unknown as PermissionUsageRepository,
      new AuditLogUsageDetector(() => "100000000000000001"),
      new MessageUsageDetector(),
      pino({ level: "silent" }),
    );
  });

  test("marks tracking started once per guild", async () => {
    await recorder.recordAuditLogEntry(banEntry());
    await recorder.recordAuditLogEntry(banEntry());

    expect(repository.ensureTrackingStarted).toHaveBeenCalledTimes(1);
    expect(repository.record).toHaveBeenCalledTimes(2);
  });

  test("retries tracking start after a failure", async () => {
    repository.ensureTrackingStarted.mockImplementationOnce(() =>
      Promise.reject(new Error("db down")),
    );

    await recorder.recordAuditLogEntry(banEntry());
    await recorder.recordAuditLogEntry(banEntry());

    expect(repository.ensureTrackingStarted).toHaveBeenCalledTimes(2);
  });

  test("swallows repository errors", async () => {
    repository.record.mockImplementation(() =>
      Promise.reject(new Error("db down")),
    );

    await expect(
      recorder.recordSushiiAction({
        guildId: GUILD_ID,
        userId: MOD_ID,
        permission: "BanMembers",
        channelId: null,
      }),
    ).resolves.toBeUndefined();
  });

  test("skips the database for messages that use nothing", async () => {
    await recorder.recordMessage({
      guildId: GUILD_ID,
      authorId: MOD_ID,
      channelId: "600000000000000006",
      occurredAt: new Date(),
      mentionsEveryone: false,
      mentionsNonMentionableRole: false,
      tts: false,
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  test("records sushii actions with the sushii_action source", async () => {
    await recorder.recordSushiiAction({
      guildId: GUILD_ID,
      userId: MOD_ID,
      permission: "KickMembers",
      channelId: null,
    });

    const [usages] = repository.record.mock.calls[0] as [
      { source: string; permission: string }[],
    ];
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      source: "sushii_action",
      permission: "KickMembers",
      userId: MOD_ID,
    });
  });

  test("forgetGuild resets tracking so a re-added guild starts again", async () => {
    await recorder.recordAuditLogEntry(banEntry());
    await recorder.forgetGuild(GUILD_ID);
    await recorder.recordAuditLogEntry(banEntry());

    expect(repository.deleteGuild).toHaveBeenCalledWith(GUILD_ID);
    expect(repository.ensureTrackingStarted).toHaveBeenCalledTimes(2);
  });
});
