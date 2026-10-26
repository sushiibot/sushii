import { describe, expect, mock, test } from "bun:test";
import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";

import type { ReplyableInteraction } from "./error";
import {
  buildInternalErrorContainer,
  interactionReplyErrorInternal,
} from "./error";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const USER_ID = "150443906511667200";

describe("buildInternalErrorContainer", () => {
  test("with a trace, shows the error ID and a feedback button carrying it", () => {
    expect(
      buildInternalErrorContainer(USER_ID, TRACE).toJSON().components,
    ).toEqual([
      {
        type: ComponentType.TextDisplay,
        content: expect.stringContaining(`**Error ID:** \`${TRACE}\``),
      },
      {
        type: ComponentType.TextDisplay,
        content: expect.stringMatching(/^-# Tell us what you were doing/),
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: "Send feedback",
            emoji: expect.objectContaining({ name: "💬" }),
            custom_id: `feedback/error/${TRACE}/${USER_ID}`,
          },
        ],
      },
    ]);
  });

  test("without a trace, there's no error ID and the button carries only the invoker", () => {
    const components = buildInternalErrorContainer(USER_ID).toJSON().components;

    expect(components[0]).toEqual({
      type: ComponentType.TextDisplay,
      content: expect.not.stringContaining("Error ID"),
    });
    expect(components[2]).toEqual({
      type: ComponentType.ActionRow,
      components: [
        expect.objectContaining({
          label: "Send feedback",
          custom_id: `feedback/error/-/${USER_ID}`,
        }),
      ],
    });
  });
});

describe("interactionReplyErrorInternal", () => {
  test("replies ephemerally with the container", async () => {
    const reply = mock((_options: unknown) => Promise.resolve());

    await interactionReplyErrorInternal(
      {
        deferred: false,
        replied: false,
        user: { id: USER_ID },
        reply,
      } as unknown as ReplyableInteraction,
      TRACE,
    );

    expect(reply).toHaveBeenCalledWith({
      components: [buildInternalErrorContainer(USER_ID, TRACE)],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  test("edits a deferred interaction with the same container", async () => {
    const editReply = mock((_options: unknown) => Promise.resolve());

    await interactionReplyErrorInternal(
      {
        deferred: true,
        replied: false,
        user: { id: USER_ID },
        editReply,
      } as unknown as ReplyableInteraction,
      TRACE,
    );

    expect(editReply).toHaveBeenCalledWith({
      components: [buildInternalErrorContainer(USER_ID, TRACE)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  });
});
