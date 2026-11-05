import { describe, expect, test } from "bun:test";
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  MessageReferenceType,
} from "discord.js";

import { SUPPORT_SERVER_URL } from "@/shared/presentation/supportServer";

import { buildFirstForwardFooter, buildForwardBody } from "./buildForwardIntro";

describe("buildForwardBody", () => {
  test("is only a forward reference", () => {
    expect(
      buildForwardBody({ guildId: "1", channelId: "2", messageId: "3" }),
    ).toEqual({
      message_reference: {
        type: MessageReferenceType.Forward,
        message_id: "3",
        channel_id: "2",
        guild_id: "1",
      },
    });
  });
});

describe("buildFirstForwardFooter", () => {
  test("explains the forward with a settings mention and support button", () => {
    const body = buildFirstForwardFooter("</settings:123>");

    expect(body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.components).toEqual([
      expect.objectContaining({
        type: ComponentType.Container,
        components: [
          expect.objectContaining({
            type: ComponentType.TextDisplay,
            content:
              "-# This is a sushii update from the support server. Turn it off in </settings:123> → Logging → sushii notifications.",
          }),
          expect.objectContaining({
            type: ComponentType.ActionRow,
            components: [
              expect.objectContaining({
                style: ButtonStyle.Link,
                url: SUPPORT_SERVER_URL,
                label: "Support server",
              }),
            ],
          }),
        ],
      }),
    ]);
  });
});
