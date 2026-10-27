import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";
import { Err, Ok, type Result } from "ts-results";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
import { SCHEDULE_CONFIG_CUSTOM_IDS } from "../ScheduleConfigConstants";
import { ScheduleConfigDeleteButtonHandler } from "./ScheduleConfigDeleteButtonHandler";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "100000000000000002";
const USER_ID = "200000000000000001";

function setup(
  removeResult: Result<void, string>,
  customId = `${SCHEDULE_CONFIG_CUSTOM_IDS.DELETE_CONFIRM_BUTTON}/${CHANNEL_ID}`,
) {
  const scheduleChannelService = {
    getByChannel: mock(async () => ({
      displayTitle: "Comebacks",
      calendarTitle: "K-pop calendar",
    })),
    remove: mock(async () => removeResult),
  };
  const emojiRepo = {
    getEmojis: mock(async () => ({ success: "✅", fail: "❌" })),
  };
  const handler = new ScheduleConfigDeleteButtonHandler(
    scheduleChannelService as unknown as ScheduleChannelService,
    { warn: mock() } as unknown as Logger,
    emojiRepo as unknown as BotEmojiRepository,
  );

  const responses = {
    reply: mock(async (_payload: unknown) => undefined),
    update: mock(async (_payload: unknown) => undefined),
    deferUpdate: mock(async () => undefined),
    editReply: mock(async (_payload: unknown) => undefined),
    deleteReply: mock(async () => undefined),
  };
  const channelSend = mock(async (_payload: unknown) => undefined);
  const interaction = {
    ...responses,
    guildId: GUILD_ID,
    user: { id: USER_ID },
    customId,
    message: { interactionMetadata: { user: { id: USER_ID } } },
    channel: {
      isTextBased: () => true,
      isDMBased: () => false,
      send: channelSend,
    },
  };

  return {
    handler,
    scheduleChannelService,
    responses,
    channelSend,
    interaction: interaction as unknown as ButtonInteraction,
  };
}

function expectOnlyUpdate(responses: ReturnType<typeof setup>["responses"]) {
  expect(responses.update).toHaveBeenCalledTimes(1);
  expect(responses.reply).not.toHaveBeenCalled();
  expect(responses.deferUpdate).not.toHaveBeenCalled();
  expect(responses.editReply).not.toHaveBeenCalled();
  return responses.update.mock.calls[0][0] as {
    components: { toJSON(): unknown }[];
    flags: number;
  };
}

function text(payload: { components: { toJSON(): unknown }[] }): string {
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

describe("ScheduleConfigDeleteButtonHandler confirm", () => {
  test("deleting updates the prompt directly, then posts publicly", async () => {
    const t = setup(Ok(undefined));

    await t.handler.handleInteraction(t.interaction);

    expect(t.scheduleChannelService.remove).toHaveBeenCalledWith(
      BigInt(GUILD_ID),
      BigInt(CHANNEL_ID),
    );
    const payload = expectOnlyUpdate(t.responses);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(text(payload)).toContain("**Deleted** **Comebacks**");
    expect(t.channelSend).toHaveBeenCalledTimes(1);
  });

  test("a failed delete updates the prompt with the error", async () => {
    const t = setup(Err("No schedule channel is configured for that channel."));

    await t.handler.handleInteraction(t.interaction);

    const payload = expectOnlyUpdate(t.responses);
    expect(text(payload)).toContain(
      "No schedule channel is configured for that channel.",
    );
    expect(t.channelSend).not.toHaveBeenCalled();
  });
});

describe("ScheduleConfigDeleteButtonHandler dismiss", () => {
  test.each([
    ["cancel", SCHEDULE_CONFIG_CUSTOM_IDS.DELETE_CANCEL_BUTTON],
    ["an unknown action", "schedule-config/delete/bogus"],
  ])("%s acks once and deletes the prompt", async (_label, customId) => {
    const t = setup(Ok(undefined), customId);

    await t.handler.handleInteraction(t.interaction);

    expect(t.responses.deferUpdate).toHaveBeenCalledTimes(1);
    expect(t.responses.deleteReply).toHaveBeenCalledTimes(1);
    expect(t.responses.update).not.toHaveBeenCalled();
    expect(t.responses.reply).not.toHaveBeenCalled();
    expect(t.scheduleChannelService.remove).not.toHaveBeenCalled();
  });
});
