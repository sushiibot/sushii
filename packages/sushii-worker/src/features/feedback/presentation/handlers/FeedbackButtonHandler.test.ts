import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction, ModalBuilder } from "discord.js";

import type { FeedbackTarget } from "../customIds";
import {
  buildErrorButtonId,
  buildPanelButtonId,
  parseModalId,
} from "../customIds";
import { FeedbackButtonHandler } from "./FeedbackButtonHandler";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const INVOKER_ID = "150443906511667200";
const OTHER_ID = "150443906511667201";

/** The message has no interaction metadata, like one sent with channel.send. */
async function shownModalTarget(customId: string, clickerId: string) {
  let modalId = "";
  const showModal = mock((modal: ModalBuilder) => {
    modalId = modal.toJSON().custom_id;
    return Promise.resolve();
  });

  await new FeedbackButtonHandler().handleInteraction({
    customId,
    showModal,
    user: { id: clickerId },
    message: { interactionMetadata: null },
  } as unknown as ButtonInteraction);

  expect(showModal).toHaveBeenCalledTimes(1);
  return parseModalId(modalId);
}

describe("FeedbackButtonHandler", () => {
  test.each<[string, string, string, FeedbackTarget]>([
    [
      "invoker keeps the trace",
      buildErrorButtonId(INVOKER_ID, TRACE),
      INVOKER_ID,
      { source: "error_report", traceId: TRACE },
    ],
    [
      "another user loses the trace",
      buildErrorButtonId(INVOKER_ID, TRACE),
      OTHER_ID,
      { source: "error_report", traceId: null },
    ],
    [
      "invoker without a trace",
      buildErrorButtonId(INVOKER_ID),
      INVOKER_ID,
      { source: "error_report", traceId: null },
    ],
    [
      "panel from any user keeps its feature",
      buildPanelButtonId("settings.logging"),
      OTHER_ID,
      { source: "panel", feature: "settings.logging" },
    ],
  ])("%s", async (_case, customId, clickerId, expected) => {
    expect(await shownModalTarget(customId, clickerId)).toEqual({
      ...expected,
      nonce: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
  });

  test("customIDMatch claims buttons but not modals or other features", () => {
    const handler = new FeedbackButtonHandler();

    expect(
      handler.customIDMatch(buildErrorButtonId(INVOKER_ID, TRACE)),
    ).not.toBe(false);
    expect(handler.customIDMatch("feedback/modal/error/-/abcdef12")).toBe(
      false,
    );
    expect(handler.customIDMatch("settings:tab:logging")).toBe(false);
  });
});
