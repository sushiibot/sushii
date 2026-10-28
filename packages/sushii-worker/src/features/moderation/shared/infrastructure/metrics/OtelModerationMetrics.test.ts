import type { Meter } from "@opentelemetry/api";
import { describe, expect, mock, test } from "bun:test";

import { OtelModerationMetrics } from "./OtelModerationMetrics";

function fakeMeter() {
  const counters = new Map<string, ReturnType<typeof mock>>();
  const meter = {
    createCounter: (name: string) => {
      const add = mock();
      counters.set(name, add);
      return { add };
    },
  } as unknown as Meter;

  return {
    meter,
    adds: (name: string) => counters.get(name)?.mock.calls ?? [],
  };
}

describe("OtelModerationMetrics", () => {
  test("starts every mod log edit failure series at 0", () => {
    const { meter, adds } = fakeMeter();
    new OtelModerationMetrics(meter);

    expect(adds("moderation.modlog.edit")).toEqual([
      [0, { kind: "legacy_conversion", outcome: "failed" }],
      [0, { kind: "v2", outcome: "failed" }],
      [0, { kind: "dm_edit", outcome: "failed" }],
      [0, { kind: "dm_delete", outcome: "failed" }],
    ]);
  });

  test("records each counter with its labels", () => {
    const { meter, adds } = fakeMeter();
    const metrics = new OtelModerationMetrics(meter);

    metrics.recordReasonResolved("edit", "template");
    metrics.recordTemplateChange("create", "checkbox", "conflict");
    metrics.recordSavePrompt("shown");
    metrics.recordActionResponseButton("delete_dm", "expired");
    metrics.recordModLogEdit("dm_edit", "ok");

    expect(adds("moderation.reason.resolved")).toEqual([
      [1, { surface: "edit", source: "template" }],
    ]);
    expect(adds("moderation.reason_template.change")).toEqual([
      [1, { action: "create", origin: "checkbox", outcome: "conflict" }],
    ]);
    expect(adds("moderation.reason_template.save_prompt")).toEqual([
      [1, { event: "shown" }],
    ]);
    expect(adds("moderation.action_response.button")).toEqual([
      [1, { button: "delete_dm", outcome: "expired" }],
    ]);
    expect(adds("moderation.modlog.edit").slice(4)).toEqual([
      [1, { kind: "dm_edit", outcome: "ok" }],
    ]);
  });
});
