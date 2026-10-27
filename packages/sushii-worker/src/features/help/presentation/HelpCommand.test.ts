import { describe, expect, mock, test } from "bun:test";
import type {
  ChatInputCommandInteraction,
  InteractionReplyOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import {
  ALL_EMOJIS,
  KNOWN_MENTIONS,
  PERMISSIONS,
  catalogCommandList,
  searchCommandList,
} from "@/test/fixtures/help";

import { HelpCommand } from "./HelpCommand";
import { HelpRenderer } from "./HelpRenderer";

function setup(query: string | null) {
  const emojiRepository = {
    getEmojis: mock(async () => ALL_EMOJIS),
  } as unknown as BotEmojiRepository;
  const command = new HelpCommand(
    new HelpRenderer(searchCommandList, emojiRepository, KNOWN_MENTIONS),
  );
  const reply = mock((_options: InteractionReplyOptions) => Promise.resolve());
  const interaction = {
    memberPermissions: PERMISSIONS.member,
    guildId: "167058919611564043",
    options: { getString: () => query },
    reply,
  } as unknown as ChatInputCommandInteraction;
  return { command, reply, interaction };
}

describe("HelpCommand", () => {
  test("replies ephemerally with the Members tab, without mentions", async () => {
    const emojiRepository = {
      getEmojis: mock(async () => ALL_EMOJIS),
    } as unknown as BotEmojiRepository;
    const command = new HelpCommand(
      new HelpRenderer(catalogCommandList, emojiRepository, KNOWN_MENTIONS),
    );
    const reply = mock((_options: InteractionReplyOptions) =>
      Promise.resolve(),
    );
    const interaction = {
      memberPermissions: PERMISSIONS.member,
      guildId: "167058919611564043",
      options: { getString: () => null },
      reply,
    } as unknown as ChatInputCommandInteraction;

    await command.handler(interaction);

    const options = reply.mock.calls[0][0];
    expect(options.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(options.allowedMentions).toEqual({ parse: [] });
    expect(JSON.stringify(options.components)).toContain("What sushii can do");
  });

  test("replies with the detail card when searching", async () => {
    const { command, reply, interaction } = setup(" rank ");

    await command.handler(interaction);

    const options = reply.mock.calls[0][0];
    expect(options.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(options.allowedMentions).toEqual({ parse: [] });
    expect(JSON.stringify(options.components)).toContain("Members tab");
  });

  test("shows the tabs when searching for help itself", async () => {
    const { command, reply, interaction } = setup("/Help");

    await command.handler(interaction);

    expect(JSON.stringify(reply.mock.calls[0][0].components)).toContain(
      "What sushii can do",
    );
  });

  test("shows the tabs for a blank search", async () => {
    const { command, reply, interaction } = setup("   ");

    await command.handler(interaction);

    expect(JSON.stringify(reply.mock.calls[0][0].components)).toContain(
      "What sushii can do",
    );
  });
});
