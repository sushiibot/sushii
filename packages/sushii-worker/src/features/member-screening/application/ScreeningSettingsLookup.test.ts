import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import type { ActiveScreeningSettings } from "../domain/types";
import { defaultScreeningSettings } from "../domain/types";
import { ScreeningSettingsLookup } from "./ScreeningSettingsLookup";

const GUILD = "100000000000000001";

const active: ActiveScreeningSettings = {
  ...defaultScreeningSettings(GUILD),
  enabled: true,
  logChannelId: "300000000000000001",
};

function setup() {
  const activeSettings = mock(
    async (): Promise<ActiveScreeningSettings | null> => active,
  );
  const logger = pino({ level: "silent" });
  const warn = mock(() => undefined);
  logger.warn = warn as unknown as typeof logger.warn;
  let now = 0;
  const lookup = new ScreeningSettingsLookup(
    { activeSettings },
    logger,
    () => now,
  );
  const advance = (ms: number) => {
    now += ms;
  };
  return { lookup, activeSettings, warn, advance };
}

describe("ScreeningSettingsLookup", () => {
  test("returns the active settings", async () => {
    const t = setup();

    expect(await t.lookup.find(GUILD)).toEqual(active);
    expect(t.activeSettings).toHaveBeenCalledWith(GUILD);
  });

  test("returns null when screening isn't active", async () => {
    const t = setup();
    t.activeSettings.mockImplementation(async () => null);

    expect(await t.lookup.find(GUILD)).toBeNull();
    expect(t.warn).not.toHaveBeenCalled();
  });

  test("a failed lookup returns null and warns at most once per minute", async () => {
    const t = setup();
    t.activeSettings.mockImplementation(async () => {
      throw new Error("feature flags not loaded");
    });

    expect(await t.lookup.find(GUILD)).toBeNull();
    t.advance(30_000);
    expect(await t.lookup.find(GUILD)).toBeNull();
    t.advance(30_000);
    expect(await t.lookup.find(GUILD)).toBeNull();

    expect(t.warn).toHaveBeenCalledTimes(2);
  });
});
