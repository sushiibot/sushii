import { describe, expect, mock, test } from "bun:test";
import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  ThreadChannel,
} from "discord.js";

import type { PermissionUsageRecorder } from "../../application/PermissionUsageRecorder";
import { AuditLogUsageHandler } from "./AuditLogUsageHandler";

const GUILD = { id: "200000000000000002" } as Guild;

function createEntry(
  overrides: Partial<GuildAuditLogsEntry>,
): GuildAuditLogsEntry {
  return {
    action: AuditLogEvent.MessagePin,
    executorId: "300000000000000003",
    targetId: "400000000000000004",
    target: null,
    extra: null,
    changes: [],
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  } as unknown as GuildAuditLogsEntry;
}

async function handle(entry: GuildAuditLogsEntry) {
  const recordAuditLogEntry = mock((_input: Record<string, unknown>) =>
    Promise.resolve(),
  );
  const handler = new AuditLogUsageHandler({
    recordAuditLogEntry,
  } as unknown as PermissionUsageRecorder);

  await handler.handle(entry, GUILD);

  const [input] = recordAuditLogEntry.mock.calls[0] ?? [];
  expect(input).toBeDefined();
  return input as Record<string, unknown>;
}

describe("AuditLogUsageHandler", () => {
  test("maps the entry fields", async () => {
    const input = await handle(
      createEntry({
        action: AuditLogEvent.MemberUpdate,
        changes: [{ key: "nick", old: "a", new: "b" }],
      } as Partial<GuildAuditLogsEntry>),
    );

    expect(input).toMatchObject({
      guildId: GUILD.id,
      action: AuditLogEvent.MemberUpdate,
      executorId: "300000000000000003",
      targetId: "400000000000000004",
      changeKeys: ["nick"],
      targetOwnerId: null,
    });
  });

  test("reads the channel from extra", async () => {
    const input = await handle(
      createEntry({
        extra: { channel: { id: "600000000000000006" }, messageId: "1" },
      } as unknown as Partial<GuildAuditLogsEntry>),
    );

    expect(input.channelId).toBe("600000000000000006");
  });

  test.each([null, { count: 3 }, { channel: null }, { channel: { id: 5 } }])(
    "channel is null for extra %p",
    async (extra) => {
      const input = await handle(
        createEntry({ extra } as unknown as Partial<GuildAuditLogsEntry>),
      );

      expect(input.channelId).toBeNull();
    },
  );

  test("passes the thread owner for thread targets", async () => {
    const thread = Object.create(ThreadChannel.prototype) as ThreadChannel;
    Object.defineProperty(thread, "ownerId", { value: "800000000000000008" });

    const input = await handle(
      createEntry({
        action: AuditLogEvent.ThreadUpdate,
        target: thread,
      } as unknown as Partial<GuildAuditLogsEntry>),
    );

    expect(input.targetOwnerId).toBe("800000000000000008");
  });
});
