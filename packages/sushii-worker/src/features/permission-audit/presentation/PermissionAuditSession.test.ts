import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { EventEmitter } from "node:events";
import pino from "pino";

import type { AuditResult } from "../application/PermissionAuditService";
import { PermissionAuditSession } from "./PermissionAuditSession";
import { PERMISSION_AUDIT_CUSTOM_IDS } from "./customIds";

const OWNER_ID = "300000000000000003";

const RESULT: AuditResult = {
  report: {
    findings: [
      {
        finding: {
          type: "everyone_dangerous",
          roleId: "1000",
          permissions: ["MentionEveryone"],
        },
        severity: "high",
        tab: "roles",
      },
    ],
    bots: [],
    members: [],
    notTracked: [],
    holderCounts: {},
  },
  context: {
    guildName: "Test",
    canViewAuditLog: true,
    historyStart: new Date(),
    backfillPending: false,
    cachedMembers: 1,
    totalMembers: 1,
  },
};

function setup() {
  const collector = new EventEmitter();
  const interaction = {
    guildId: "1000",
    user: { id: OWNER_ID },
    reply: mock(() =>
      Promise.resolve({
        resource: {
          message: { createMessageComponentCollector: () => collector },
        },
      }),
    ),
    editReply: mock(() => Promise.resolve()),
  };
  const session = new PermissionAuditSession(
    interaction as unknown as ChatInputCommandInteraction<"cached">,
    RESULT,
    pino({ level: "silent" }),
  );
  return { collector, interaction, session };
}

function click(userId: string, customId: string) {
  return {
    user: { id: userId },
    customId,
    update: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
    reply: mock(() =>
      Promise.resolve({ delete: mock(() => Promise.resolve()) }),
    ),
    replied: false,
    deferred: false,
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PermissionAuditSession", () => {
  test("replies ephemerally", async () => {
    const { interaction, session } = setup();

    await session.start();

    const [options] = interaction.reply.mock.calls[0] as unknown as [
      { flags: number; withResponse: boolean },
    ];
    expect(options.withResponse).toBe(true);
    expect(options.flags & 64).toBe(64);
  });

  test("expires through the original interaction when nothing was clicked", async () => {
    const { collector, interaction, session } = setup();
    await session.start();

    collector.emit("end");
    await flush();

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  test("expires through the latest click, whose token is still valid", async () => {
    const { collector, interaction, session } = setup();
    await session.start();

    const button = click(OWNER_ID, PERMISSION_AUDIT_CUSTOM_IDS.tabRoles);
    collector.emit("collect", button);
    await flush();
    collector.emit("end");
    await flush();

    expect(button.update).toHaveBeenCalledTimes(1);
    expect(button.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test("rejects other users without changing the view", async () => {
    const { collector, session } = setup();
    await session.start();

    const button = click("999", PERMISSION_AUDIT_CUSTOM_IDS.tabRoles);
    collector.emit("collect", button);
    await flush();

    expect(button.reply).toHaveBeenCalledTimes(1);
    expect(button.update).not.toHaveBeenCalled();
  });
});
