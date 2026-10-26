import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { EventEmitter } from "node:events";
import pino from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";

import {
  type AuditResult,
  PermissionAuditService,
} from "../../application/PermissionAuditService";
import { PermissionChangeService } from "../../application/PermissionChangeService";
import { PermissionAuditCommand } from "./PermissionAuditCommand";

const GUILD_ID = "100000000000000000";
const USER_ID = "300000000000000003";

const CLEAN_RESULT: AuditResult = {
  report: { findings: [], bots: [], notTracked: [] },
  context: {
    guildName: "Test",
    canViewAuditLog: true,
    historyStart: new Date(),
    backfillPending: false,
  },
  snapshot: {
    guildId: GUILD_ID,
    ownerId: USER_ID,
    everyoneRoleId: GUILD_ID,
    mfaRequired: false,
    roles: [],
    overwrites: [],
    memberCount: 1,
    members: new Map(),
    selfAssignable: [],
    now: new Date(),
  },
};

interface FeedbackAccessory {
  custom_id?: string;
  emoji?: { id?: string; name?: string };
}

async function run(messageEmoji: string) {
  const auditService = Object.create(
    PermissionAuditService.prototype,
  ) as PermissionAuditService;
  auditService.generate = mock(async () => CLEAN_RESULT);
  const changeService = Object.create(
    PermissionChangeService.prototype,
  ) as PermissionChangeService;
  const getEmojis = mock(async () => ({ message: messageEmoji }));
  const emojiRepository = { getEmojis } as unknown as BotEmojiRepository;

  const editReply = mock(async (_options: unknown) => ({
    createMessageComponentCollector: () => new EventEmitter(),
  }));
  const interaction = {
    inCachedGuild: () => true,
    memberPermissions: { has: () => true },
    guild: {},
    guildId: GUILD_ID,
    user: { id: USER_ID },
    deferReply: mock(async () => undefined),
    editReply,
  };

  const command = new PermissionAuditCommand(
    auditService,
    changeService,
    pino({ level: "silent" }),
    emojiRepository,
  );
  await command.handler(interaction as unknown as ChatInputCommandInteraction);

  const [sent] = editReply.mock.calls[0] as unknown as [
    { components: { toJSON(): unknown }[] },
  ];
  const json = sent.components[0].toJSON() as {
    components: { accessory?: FeedbackAccessory }[];
  };
  return { getEmojis, accessory: json.components.at(-1)?.accessory };
}

describe("PermissionAuditCommand", () => {
  test("an unsynced message emoji falls back to 💬", async () => {
    const { getEmojis, accessory } = await run("");

    expect(getEmojis).toHaveBeenCalledWith(["message"]);
    expect(accessory?.custom_id).toBe("feedback/panel/permission-audit");
    expect(accessory?.emoji).toEqual(expect.objectContaining({ name: "💬" }));
  });

  test("a synced message emoji is used on the Feedback button", async () => {
    const { accessory } = await run("<:message:200000000000000000>");

    expect(accessory?.emoji).toEqual(
      expect.objectContaining({ id: "200000000000000000", name: "message" }),
    );
  });
});
