import { describe, expect, mock, test } from "bun:test";

import type { ScreeningGuildPatch } from "../domain/repositories/ScreeningGuildRepository";
import type { ScreeningGuildSettings } from "../domain/types";
import { defaultScreeningSettings } from "../domain/types";
import { ScreeningSettingsService } from "./ScreeningSettingsService";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";

function setup(flagOn: boolean, row: ScreeningGuildSettings | null) {
  const flagRepo = { isEnabled: mock(async () => flagOn) };
  const guildRepo = {
    findByGuildId: mock(async () => row),
    patch: mock(async (guildId: string, changes: ScreeningGuildPatch) => ({
      ...defaultScreeningSettings(guildId),
      ...changes,
    })),
  };
  return {
    service: new ScreeningSettingsService(flagRepo, guildRepo),
    flagRepo,
    guildRepo,
  };
}

const row: ScreeningGuildSettings = {
  ...defaultScreeningSettings(GUILD),
  enabled: true,
  logChannelId: CHANNEL,
  checkAvatars: false,
  maxMessages: 5,
};

describe("ScreeningSettingsService.getForSettings", () => {
  test("null when the flag is off", async () => {
    const t = setup(false, row);

    expect(await t.service.getForSettings(GUILD)).toBeNull();
    expect(t.flagRepo.isEnabled).toHaveBeenCalledWith(
      GUILD,
      "member_screening",
    );
    expect(t.guildRepo.findByGuildId).not.toHaveBeenCalled();
  });

  test("the row's state when the flag is on", async () => {
    const t = setup(true, row);

    expect(await t.service.getForSettings(GUILD)).toEqual({
      enabled: true,
      logChannelId: CHANNEL,
      checkAvatars: false,
    });
  });

  test("defaults when the flag is on and there's no row", async () => {
    const t = setup(true, null);

    expect(await t.service.getForSettings(GUILD)).toEqual({
      enabled: false,
      logChannelId: null,
      checkAvatars: true,
    });
  });
});

describe("ScreeningSettingsService flag failures", () => {
  test("getForSettings propagates flag lookup failures", async () => {
    const t = setup(true, row);
    t.flagRepo.isEnabled.mockImplementation(async () => {
      throw new Error("db down");
    });

    await expect(t.service.getForSettings(GUILD)).rejects.toThrow("db down");
  });
});

describe("ScreeningSettingsService.getState", () => {
  test("reads the row without checking the flag", async () => {
    const t = setup(false, row);

    expect(await t.service.getState(GUILD)).toEqual({
      enabled: true,
      logChannelId: CHANNEL,
      checkAvatars: false,
    });
    expect(t.flagRepo.isEnabled).not.toHaveBeenCalled();
  });

  test("null when there's no row", async () => {
    expect(await setup(true, null).service.getState(GUILD)).toBeNull();
  });
});

describe("ScreeningSettingsService setters", () => {
  test("setEnabled patches only enabled", async () => {
    const t = setup(true, null);

    await t.service.setEnabled(GUILD, true);

    expect(t.guildRepo.patch).toHaveBeenCalledWith(GUILD, { enabled: true });
  });

  test("setLogChannel patches the channel, including clearing it", async () => {
    const t = setup(true, row);

    await t.service.setLogChannel(GUILD, CHANNEL);
    await t.service.setLogChannel(GUILD, null);

    expect(t.guildRepo.patch).toHaveBeenNthCalledWith(1, GUILD, {
      logChannelId: CHANNEL,
    });
    expect(t.guildRepo.patch).toHaveBeenNthCalledWith(2, GUILD, {
      logChannelId: null,
    });
  });

  test("setCheckAvatars patches only checkAvatars", async () => {
    const t = setup(true, row);

    await t.service.setCheckAvatars(GUILD, false);

    expect(t.guildRepo.patch).toHaveBeenCalledWith(GUILD, {
      checkAvatars: false,
    });
  });

  test("setters don't check the flag", async () => {
    const t = setup(false, null);

    await t.service.setEnabled(GUILD, true);

    expect(t.flagRepo.isEnabled).not.toHaveBeenCalled();
    expect(t.guildRepo.patch).toHaveBeenCalledTimes(1);
  });
});
