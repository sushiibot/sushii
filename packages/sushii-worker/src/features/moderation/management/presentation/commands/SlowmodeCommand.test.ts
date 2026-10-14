import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { PermissionUsageRecorder } from "@/features/permission-audit";

import type { SlowmodeService } from "../../application/SlowmodeService";
import { SlowmodeCommand } from "./SlowmodeCommand";

const GUILD_ID = "200000000000000002";
const CHANNEL_ID = "600000000000000006";
const MOD_ID = "300000000000000003";

async function run(updateResult: unknown) {
  const recordSushiiAction = mock(() => Promise.resolve());
  const command = new SlowmodeCommand(
    {
      updateSlowmode: mock(() => Promise.resolve(updateResult)),
    } as unknown as SlowmodeService,
    { recordSushiiAction } as unknown as PermissionUsageRecorder,
    pino({ level: "silent" }),
  );

  const interaction = {
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    user: { id: MOD_ID },
    channel: { id: CHANNEL_ID, guildId: GUILD_ID, isTextBased: () => true },
    options: {
      getString: () => "5s",
      getChannel: () => null,
    },
    reply: mock(() => Promise.resolve()),
  } as unknown as ChatInputCommandInteraction;

  await command.handler(interaction);

  return recordSushiiAction;
}

describe("SlowmodeCommand permission usage", () => {
  test("records Manage Channels after a successful update", async () => {
    const recordSushiiAction = await run(
      Ok({ previousSlowmode: 0, newSlowmode: 5 }),
    );

    expect(recordSushiiAction).toHaveBeenCalledWith({
      guildId: GUILD_ID,
      userId: MOD_ID,
      permission: "ManageChannels",
      channelId: CHANNEL_ID,
    });
  });

  test("records nothing when the update fails", async () => {
    const recordSushiiAction = await run(Err("Missing permissions"));

    expect(recordSushiiAction).not.toHaveBeenCalled();
  });
});
