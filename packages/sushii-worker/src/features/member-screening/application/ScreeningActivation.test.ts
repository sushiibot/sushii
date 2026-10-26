import { describe, expect, mock, test } from "bun:test";

import type { ScreeningGuildSettings } from "../domain/types";
import { defaultScreeningSettings } from "../domain/types";
import { ScreeningActivation } from "./ScreeningActivation";

const GUILD = "100000000000000001";

function setup(flagOn: boolean, settings: ScreeningGuildSettings | null) {
  const flagRepo = { isEnabled: mock(async () => flagOn) };
  const guildRepo = { findByGuildId: mock(async () => settings) };
  return {
    activation: new ScreeningActivation(flagRepo, guildRepo),
    flagRepo,
    guildRepo,
  };
}

const active: ScreeningGuildSettings = {
  ...defaultScreeningSettings(GUILD),
  enabled: true,
  logChannelId: "300000000000000001",
};

describe("ScreeningActivation", () => {
  test("returns settings when screening is active", async () => {
    const t = setup(true, active);

    expect(await t.activation.activeSettings(GUILD)).toEqual(active);
    expect(t.flagRepo.isEnabled).toHaveBeenCalledWith(
      GUILD,
      "member_screening",
    );
    expect(t.guildRepo.findByGuildId).toHaveBeenCalledWith(GUILD);
  });

  test("doesn't read settings when the flag is off", async () => {
    const t = setup(false, active);

    expect(await t.activation.activeSettings(GUILD)).toBeNull();
    expect(t.guildRepo.findByGuildId).not.toHaveBeenCalled();
  });

  test.each([
    ["there's no row", null],
    ["mods haven't turned it on", { ...active, enabled: false }],
    ["there's no log channel", { ...active, logChannelId: null }],
  ])("returns null when %s", async (_label, settings) => {
    const t = setup(true, settings);

    expect(await t.activation.activeSettings(GUILD)).toBeNull();
  });

  test("flagEnabled reads the member_screening flag", async () => {
    expect(await setup(true, null).activation.flagEnabled(GUILD)).toBe(true);
    expect(await setup(false, null).activation.flagEnabled(GUILD)).toBe(false);
  });

  test("propagates flag lookup failures", async () => {
    const t = setup(true, active);
    t.flagRepo.isEnabled.mockImplementation(async () => {
      throw new Error("db down");
    });

    await expect(t.activation.activeSettings(GUILD)).rejects.toThrow("db down");
    expect(t.guildRepo.findByGuildId).not.toHaveBeenCalled();
  });
});
