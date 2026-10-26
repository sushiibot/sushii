import { describe, expect, test } from "bun:test";

import { isScreeningActive } from "./isScreeningActive";
import { defaultScreeningSettings } from "./types";

const active = {
  ...defaultScreeningSettings("100000000000000001"),
  enabled: true,
  logChannelId: "300000000000000001",
};

describe("isScreeningActive", () => {
  test("needs the flag, mods turning it on and a log channel", () => {
    expect(isScreeningActive(true, active)).toBe(true);
  });

  test.each([
    ["flag off", false, active],
    ["no settings row", true, null],
    ["mods haven't turned it on", true, { ...active, enabled: false }],
    ["no log channel", true, { ...active, logChannelId: null }],
  ])("inactive when %s", (_label, flagOn, settings) => {
    expect(isScreeningActive(flagOn, settings)).toBe(false);
  });
});
