import { describe, expect, test } from "bun:test";

import {
  buildErrorButtonId,
  buildModalId,
  buildPanelButtonId,
  isFeedbackCustomId,
  parseButtonId,
  parseModalId,
} from "./customIds";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const USER_ID = "150443906511667200";

describe("button IDs", () => {
  test("error button round-trips the trace and invoker", () => {
    const id = buildErrorButtonId(USER_ID, TRACE);

    expect(id).toBe(`feedback/error/${TRACE}/${USER_ID}`);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(parseButtonId(id)).toEqual({
      source: "error_report",
      traceId: TRACE,
      invokerId: USER_ID,
    });
  });

  test("error button without a trace keeps the invoker", () => {
    const id = buildErrorButtonId(USER_ID);

    expect(id).toBe(`feedback/error/-/${USER_ID}`);
    expect(parseButtonId(id)).toEqual({
      source: "error_report",
      traceId: null,
      invokerId: USER_ID,
    });
  });

  test("a malformed or all-zero trace is dropped", () => {
    expect(buildErrorButtonId(USER_ID, "not-a-trace")).toBe(
      `feedback/error/-/${USER_ID}`,
    );
    expect(buildErrorButtonId(USER_ID, "0".repeat(32))).toBe(
      `feedback/error/-/${USER_ID}`,
    );
    expect(
      buildModalId({ source: "error_report", traceId: "0".repeat(32) }),
    ).toMatch(/^feedback\/modal\/error\/-\//);
  });

  test("an invalid invoker ID falls back to an unattributed button", () => {
    expect(buildErrorButtonId("not-a-user", TRACE)).toBe("feedback/error");
  });

  test("the unattributed button parses with no trace or invoker", () => {
    expect(parseButtonId("feedback/error")).toEqual({
      source: "error_report",
      traceId: null,
      invokerId: null,
    });
  });

  test("panel button round-trips", () => {
    expect(buildPanelButtonId("settings.logging")).toBe(
      "feedback/panel/settings.logging",
    );
    expect(parseButtonId(buildPanelButtonId("permission-audit"))).toEqual({
      source: "panel",
      feature: "permission-audit",
    });
  });

  test.each([
    "feedback/error/",
    `feedback/error/${TRACE}`,
    `feedback/error/${"0".repeat(32)}`,
    "feedback/error/4BF92F3577B34DA6A3CE929D0E0E4736",
    "feedback/error/abc",
    `feedback/error/${"0".repeat(32)}/${USER_ID}`,
    `feedback/error/${TRACE}/123`,
    `feedback/error/${TRACE}/${USER_ID}/extra`,
    `feedback/error/-/${USER_ID}/`,
    "feedback/error/-",
    "feedback/panel/settings.unknown",
    "feedback/panel/",
    "feedback/panel/settings.logging/extra",
    "feedback/modal/error/-/abcdef12",
    "settings:tab:logging",
  ])("rejects %s", (customId) => {
    expect(parseButtonId(customId)).toBeNull();
  });
});

describe("modal IDs", () => {
  test("error modal round-trips the trace and nonce", () => {
    const id = buildModalId({ source: "error_report", traceId: TRACE });

    expect(id).toMatch(
      new RegExp(`^feedback/modal/error/${TRACE}/[0-9a-f]{8}$`),
    );
    expect(parseModalId(id)).toEqual({
      source: "error_report",
      traceId: TRACE,
      nonce: id.slice(-8),
    });
  });

  test("error modal without a trace uses a placeholder segment", () => {
    const id = buildModalId({ source: "error_report", traceId: null });

    expect(id).toMatch(/^feedback\/modal\/error\/-\/[0-9a-f]{8}$/);
    expect(parseModalId(id)).toEqual({
      source: "error_report",
      traceId: null,
      nonce: id.slice(-8),
    });
  });

  test("panel modal round-trips the feature and nonce", () => {
    const id = buildModalId({ source: "panel", feature: "settings.automod" });

    expect(id).toMatch(
      /^feedback\/modal\/panel\/settings\.automod\/[0-9a-f]{8}$/,
    );
    expect(parseModalId(id)).toEqual({
      source: "panel",
      feature: "settings.automod",
      nonce: id.slice(-8),
    });
  });

  test("each build gets a new nonce", () => {
    const a = buildModalId({ source: "panel", feature: "settings.welcome" });
    const b = buildModalId({ source: "panel", feature: "settings.welcome" });

    expect(a).not.toBe(b);
  });

  test.each([
    "feedback/modal/error",
    `feedback/modal/error/${"0".repeat(32)}/abcdef12`,
    `feedback/modal/error/${TRACE}`,
    `feedback/modal/error/${TRACE}/abc`,
    `feedback/modal/error/${TRACE}/abcdef12/`,
    "feedback/modal/panel/settings.logging",
    "feedback/modal/panel/settings.nope/abcdef12",
    "feedback/modal/panel/settings.logging/ABCDEF12",
    "feedback/error",
  ])("rejects %s", (customId) => {
    expect(parseModalId(customId)).toBeNull();
  });
});

test("isFeedbackCustomId matches every feedback ID and nothing else", () => {
  expect(isFeedbackCustomId(buildErrorButtonId(USER_ID, TRACE))).toBe(true);
  expect(isFeedbackCustomId(buildPanelButtonId("settings.overview"))).toBe(
    true,
  );
  expect(
    isFeedbackCustomId(
      buildModalId({ source: "panel", feature: "permission-audit" }),
    ),
  ).toBe(true);
  expect(isFeedbackCustomId("settings:tab:overview")).toBe(false);
  expect(isFeedbackCustomId("feedbackx")).toBe(false);
});
