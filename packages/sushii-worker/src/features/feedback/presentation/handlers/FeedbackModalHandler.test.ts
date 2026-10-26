import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { Err, Ok } from "ts-results";

import type { FeedbackService } from "../../application/FeedbackService";
import { buildModalId } from "../customIds";
import { FeedbackModalHandler } from "./FeedbackModalHandler";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const USER_ID = "150443906511667200";
const GUILD_ID = "167058919611564043";
const CONTENT = "  It errored right after I picked the channel.  ";

function replyWithText(text: string, extra: Record<string, unknown> = {}) {
  return expect.objectContaining({
    ...extra,
    components: [
      expect.objectContaining({
        components: [
          expect.objectContaining({ content: expect.stringContaining(text) }),
        ],
      }),
    ],
  });
}

function makeInteraction(
  customId: string,
  kind: string[] | null,
  content = CONTENT,
) {
  const getStringSelectValues = mock((id: string) => {
    if (id !== "kind" || kind === null) {
      throw new Error(`no field ${id}`);
    }
    return kind;
  });

  return {
    customId,
    user: { id: USER_ID, username: "tzuyu" },
    guildId: GUILD_ID,
    guild: { name: "ONCE" },
    fields: {
      getTextInputValue: mock(() => content),
      getStringSelectValues,
    },
    reply: mock(() => Promise.resolve()),
    deferReply: mock(() => Promise.resolve()),
    editReply: mock(() => Promise.resolve()),
  };
}

describe("FeedbackModalHandler", () => {
  let submit: ReturnType<typeof mock>;
  let handler: FeedbackModalHandler;

  beforeEach(() => {
    submit = mock(async () => Ok.EMPTY);
    const service = Object.create(null) as FeedbackService;
    Object.assign(service, { submit });
    handler = new FeedbackModalHandler(service);
  });

  test("panel source reads the kind from the select", async () => {
    const interaction = makeInteraction(
      buildModalId({ source: "panel", feature: "settings.logging" }),
      ["praise"],
    );

    await handler.handleModalSubmit(
      interaction as unknown as ModalSubmitInteraction,
    );

    expect(submit).toHaveBeenCalledWith({
      source: "panel",
      kind: "praise",
      feature: "settings.logging",
      traceId: null,
      userId: USER_ID,
      guildId: GUILD_ID,
      content: CONTENT.trim(),
      reporter: { username: "tzuyu", guildName: "ONCE" },
    });
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      replyWithText("Thanks!"),
    );
  });

  test("error source defaults to broken without reading a select", async () => {
    const interaction = makeInteraction(
      buildModalId({ source: "error_report", traceId: TRACE }),
      null,
    );

    await handler.handleModalSubmit(
      interaction as unknown as ModalSubmitInteraction,
    );

    expect(interaction.fields.getStringSelectValues).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "error_report",
        kind: "broken",
        feature: null,
        traceId: TRACE,
      }),
    );
  });

  test("panel source with an unknown kind throws", async () => {
    const interaction = makeInteraction(
      buildModalId({ source: "panel", feature: "permission-audit" }),
      ["spam"],
    );

    await expect(
      handler.handleModalSubmit(
        interaction as unknown as ModalSubmitInteraction,
      ),
    ).rejects.toThrow("Invalid feedback kind");
    expect(submit).not.toHaveBeenCalled();
  });

  test("rate-limited submissions get the slow-down reply", async () => {
    submit.mockResolvedValue(Err("rate_limited"));
    const interaction = makeInteraction(
      buildModalId({ source: "error_report", traceId: null }),
      null,
    );

    await handler.handleModalSubmit(
      interaction as unknown as ModalSubmitInteraction,
    );

    expect(interaction.editReply).toHaveBeenCalledWith(
      replyWithText("Slow down a little"),
    );
  });

  test.each([
    ["short after trimming", "    short     ", "at least 10 characters"],
    [
      "padded with zero-width characters",
      `ok${"\u200B\u200C\u200D\u2060\uFEFF".repeat(4)}`,
      "at least 10 characters",
    ],
    [
      "padded with Hangul filler, braille blank and soft hyphens",
      `ok${"\u3164\u2800\u00AD".repeat(4)}`,
      "at least 10 characters",
    ],
    ["over the maximum", "a".repeat(1001), "at most 1000 characters"],
    [
      "over the maximum in code points",
      "😀".repeat(1001),
      "at most 1000 characters",
    ],
  ])("content %s is rejected", async (_case, content, message) => {
    const interaction = makeInteraction(
      buildModalId({ source: "error_report", traceId: TRACE }),
      null,
      content,
    );

    await handler.handleModalSubmit(
      interaction as unknown as ModalSubmitInteraction,
    );

    expect(submit).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      replyWithText(message, {
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      }),
    );
  });

  test.each([
    [
      "a ZWJ emoji family is stored intact",
      "  👨\u200D👩\u200D👧 the family emoji broke  ",
      "👨\u200D👩\u200D👧 the family emoji broke",
    ],
    [
      "invisible characters are kept, only the ends are trimmed",
      "\nIt \u200Bbroke when I saved\n",
      "It \u200Bbroke when I saved",
    ],
    ["1000 emoji fit the limit", "😀".repeat(1000), "😀".repeat(1000)],
  ])("%s", async (_case, raw, stored) => {
    const interaction = makeInteraction(
      buildModalId({ source: "error_report", traceId: TRACE }),
      null,
      raw,
    );

    await handler.handleModalSubmit(
      interaction as unknown as ModalSubmitInteraction,
    );

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ content: stored }),
    );
  });

  test("customIDMatch only claims feedback modal IDs", () => {
    expect(
      handler.customIDMatch(
        buildModalId({ source: "panel", feature: "settings.overview" }),
      ),
    ).not.toBe(false);
    expect(handler.customIDMatch("feedback/error")).toBe(false);
    expect(handler.customIDMatch("scam_candidate:label:abc")).toBe(false);
  });
});
