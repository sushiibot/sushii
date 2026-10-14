import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { PermissionUsageRecorder } from "@/features/permission-audit";

import type { PruneMessageService } from "../../application/PruneMessageService";
import { PruneCommand } from "./PruneCommand";

const GUILD_ID = "200000000000000002";
const CHANNEL_ID = "600000000000000006";
const MOD_ID = "300000000000000003";

async function run(pruneResult: unknown) {
  const recordSushiiAction = mock(() => Promise.resolve());
  const command = new PruneCommand(
    {
      pruneMessages: mock(() => Promise.resolve(pruneResult)),
    } as unknown as PruneMessageService,
    { recordSushiiAction } as unknown as PermissionUsageRecorder,
    pino({ level: "silent" }),
  );

  const interaction = {
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    user: { id: MOD_ID },
    channel: { id: CHANNEL_ID, isTextBased: () => true },
    options: {
      getInteger: () => 10,
      getString: () => null,
      getUser: () => null,
      getBoolean: () => null,
    },
    reply: mock(() => Promise.resolve()),
  } as unknown as ChatInputCommandInteraction;

  await command.handler(interaction);

  return recordSushiiAction;
}

describe("PruneCommand permission usage", () => {
  test("records Manage Messages after a successful prune", async () => {
    const recordSushiiAction = await run(
      Ok({ deletedCount: 10, userDeletedSummary: new Map() }),
    );

    expect(recordSushiiAction).toHaveBeenCalledWith({
      guildId: GUILD_ID,
      userId: MOD_ID,
      permission: "ManageMessages",
      channelId: CHANNEL_ID,
    });
  });

  test("records nothing when the prune fails", async () => {
    const recordSushiiAction = await run(Err("Missing permissions"));

    expect(recordSushiiAction).not.toHaveBeenCalled();
  });
});
