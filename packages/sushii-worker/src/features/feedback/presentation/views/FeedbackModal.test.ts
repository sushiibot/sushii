import { describe, expect, test } from "bun:test";
import { ComponentType, TextInputStyle } from "discord.js";

import { buildFeedbackModal } from "./FeedbackModal";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const CONTENT_INPUT = {
  type: ComponentType.TextInput,
  custom_id: "content",
  style: TextInputStyle.Paragraph,
  required: true,
  min_length: 10,
  max_length: 1000,
  placeholder: expect.any(String),
} as const;

describe("buildFeedbackModal", () => {
  test("panel modal has the feature label, kind select and content field", () => {
    const modal = buildFeedbackModal({
      source: "panel",
      feature: "settings.logging",
    }).toJSON();

    expect(modal.title).toBe("Send feedback");
    expect(modal.components).toEqual([
      {
        type: ComponentType.TextDisplay,
        content: expect.stringContaining("About: **Logging settings**"),
      },
      {
        type: ComponentType.Label,
        label: "What kind of feedback?",
        component: expect.objectContaining({
          type: ComponentType.StringSelect,
          custom_id: "kind",
          required: true,
          min_values: 1,
          max_values: 1,
          options: [
            expect.objectContaining({
              value: "idea",
              label: "Idea or request",
            }),
            expect.objectContaining({ value: "confusing" }),
            expect.objectContaining({ value: "broken" }),
            expect.objectContaining({ value: "praise" }),
            expect.objectContaining({ value: "other", label: "Other" }),
          ],
        }),
      },
      {
        type: ComponentType.Label,
        label: "Tell us more",
        component: CONTENT_INPUT,
      },
    ]);
  });

  test("error modal has no select and mentions the attached error ID", () => {
    const modal = buildFeedbackModal({
      source: "error_report",
      traceId: TRACE,
    }).toJSON();

    expect(modal.title).toBe("Send feedback to sushii");
    expect(modal.components).toEqual([
      {
        type: ComponentType.TextDisplay,
        content: expect.stringContaining("error ID is attached"),
      },
      {
        type: ComponentType.Label,
        label: "What were you trying to do?",
        description: "What you expected and what happened instead.",
        component: CONTENT_INPUT,
      },
    ]);
  });

  test("error modal without a trace doesn't promise an error ID", () => {
    const modal = buildFeedbackModal({
      source: "error_report",
      traceId: null,
    }).toJSON();

    expect(modal.components[0]).toEqual({
      type: ComponentType.TextDisplay,
      content: expect.not.stringContaining("error ID"),
    });
  });
});
