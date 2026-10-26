import { expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import dayjs from "@/shared/domain/dayjs";

import type { FishyService } from "../../application";
import type { CollectionArtwork } from "../../infrastructure/CollectionArtwork";
import { FishyCommand } from "./FishyCommand";

for (const cooldown of [false, true]) {
  test(`fishy ${cooldown ? "cooldown" : "catch reveal"} sends one direct reply`, async () => {
    const reply = mock(() => Promise.resolve());
    const interaction = {
      id: "123",
      user: { id: "owner" },
      options: { getUser: () => ({ id: "target" }) },
      reply,
      deferReply: () => {
        throw new Error("Fishy must reply directly");
      },
      editReply: () => {
        throw new Error("Fishy must send one reply");
      },
    } as unknown as ChatInputCommandInteraction;
    const service = {
      fishyForUser: async () =>
        cooldown
          ? dayjs().add(1, "hour")
          : {
              collectibleId: "koi",
              condition: "mist",
              catchCount: 1,
              firstDiscovery: true,
              baseAmount: 10,
              caughtAmount: 10,
              oldAmount: "20",
              newAmount: "30",
              activity: { activeDays: 1, multiplier: 1 },
            },
    } as unknown as FishyService;
    const artwork = {
      load: () => Promise.resolve(new Map()),
      url: () => Promise.resolve("https://assets.example.test/koi.png"),
    } as unknown as CollectionArtwork;
    await new FishyCommand(service, artwork, {
      getEmojis: async () => ({
        fishing_mist: "<:fishing_mist:123456789012345678>",
      }),
    } as unknown as BotEmojiRepository).handler(interaction);
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(reply.mock.calls);
    expect(payload).toContain("IsComponentsV2");
    if (!cooldown) {
      expect(payload).toContain("New discovery: Koi");
      expect(payload).toContain(
        "<:fishing_mist:123456789012345678> Mist hangs over the water.",
      );
    }
  });
}
