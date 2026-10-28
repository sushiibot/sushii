import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { Ok } from "ts-results";

import { BanAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import {
  EXPIRED_LINE,
  buildActionResultMessage,
} from "../views/ModerationActionView";
import { expireResponse, expiryDelayMs } from "./responseExpiry";
import {
  GUILD,
  MOD,
  makeCase,
  makeEmojis,
  makeTarget,
  makeUser,
} from "./testFixtures";

function postedReply() {
  const message = buildActionResultMessage({
    actionType: ActionType.Ban,
    executor: makeUser(MOD, "tzuyu"),
    targets: [makeTarget("912345678901234567", "spambot")],
    results: [Ok(makeCase())],
    guildConfig: GuildConfig.createDefault(GUILD),
    action: new BanAction(
      GUILD,
      makeUser(MOD, "tzuyu"),
      null,
      null,
      "unspecified",
    ),
    emojis: makeEmojis(),
  });
  return {
    components: message.components.map((c) => ({ toJSON: () => c.toJSON() })),
  };
}

describe("expiryDelayMs", () => {
  test("lands just under 15 minutes after the command", () => {
    const created = 1_000_000;
    const delay = expiryDelayMs(created, created + 5_000);
    expect(delay).toBeLessThan(15 * 60 * 1000 - 5_000);
    expect(delay).toBeGreaterThan(14 * 60 * 1000);
    expect(expiryDelayMs(created, created + 20 * 60 * 1000)).toBe(0);
  });
});

describe("expireResponse", () => {
  test("edits the reply to the expired render once", async () => {
    let reply = postedReply();
    const editReply = mock(
      async (options: { components: { toJSON(): unknown }[] }) => {
        reply = {
          components: options.components.map((c) => ({
            toJSON: () => c.toJSON(),
          })),
        } as typeof reply;
      },
    );
    const interaction = {
      fetchReply: mock(async () => reply),
      editReply,
    } as unknown as ChatInputCommandInteraction;

    expect(await expireResponse(interaction)).toBe(true);
    expect(JSON.stringify(reply.components[0].toJSON())).toContain(
      JSON.stringify(EXPIRED_LINE).slice(1, -1),
    );
    expect(await expireResponse(interaction)).toBe(false);
    expect(editReply).toHaveBeenCalledTimes(1);
  });
});
