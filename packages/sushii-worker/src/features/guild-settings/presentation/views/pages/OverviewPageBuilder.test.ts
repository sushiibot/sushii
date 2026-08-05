import { describe, expect, test } from "bun:test";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { SETTINGS_TAB_BY_CUSTOM_ID } from "../components/SettingsChrome";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";
import {
  computeAutomodStatus,
  computeLoggingStatus,
  computeLookupStatus,
  computeMessagesStatus,
  computeModDmsStatus,
  computeModerationStatus,
  isEssentiallyUnconfigured,
} from "./OverviewPageBuilder";

const defaultConfig = GuildConfig.createDefault("123456789");

describe("compute*Status", () => {
  test("logging: default config has 0 channels set", () => {
    const status = computeLoggingStatus(defaultConfig);
    expect(status.statusText).toBe("0/4 log channels set");
    expect(status.isConfigured).toBe(false);
  });

  test("logging: partially configured config counts non-null channels", () => {
    const config = defaultConfig.clone();
    config.loggingSettings.modLogChannel = "111";
    config.loggingSettings.messageLogChannel = "222";

    const status = computeLoggingStatus(config);
    expect(status.statusText).toBe("2/4 log channels set");
    expect(status.isConfigured).toBe(true);
  });

  test("moderation: default config reads 3/4 DM notifications on (kick defaults off)", () => {
    const status = computeModerationStatus(defaultConfig);
    expect(status.statusText).toBe("3/4 DM notifications on");
    expect(status.isConfigured).toBe(true);
  });

  test("modDms: default config has 0 messages customized", () => {
    const status = computeModDmsStatus(defaultConfig);
    expect(status.statusText).toBe("0/4 messages customized");
    expect(status.isConfigured).toBe(false);
  });

  test("modDms: setting any DM text counts as customized", () => {
    const config = defaultConfig.clone();
    config.moderationSettings.warnDmText = "Please review our rules.";

    const status = computeModDmsStatus(config);
    expect(status.statusText).toBe("1/4 messages customized");
    expect(status.isConfigured).toBe(true);
  });

  test("lookup: off by default", () => {
    const status = computeLookupStatus(defaultConfig);
    expect(status.statusText).toBe("Cross-server lookup off");
    expect(status.isConfigured).toBe(false);
  });

  test("lookup: on once opted in", () => {
    const config = defaultConfig.clone();
    config.moderationSettings.lookupDetailsOptIn = true;

    const status = computeLookupStatus(config);
    expect(status.statusText).toBe("Cross-server lookup on");
    expect(status.isConfigured).toBe(true);
  });

  test("messages: welcome channel not set by default", () => {
    const status = computeMessagesStatus(defaultConfig);
    expect(status.statusText).toBe("Welcome channel not set");
    expect(status.isConfigured).toBe(false);
  });

  test("messages: welcome channel set", () => {
    const config = defaultConfig.clone();
    config.messageSettings.messageChannel = "111";

    const status = computeMessagesStatus(config);
    expect(status.statusText).toBe("Welcome channel set");
    expect(status.isConfigured).toBe(true);
  });

  test("automod: alerts channel not set by default", () => {
    const status = computeAutomodStatus(defaultConfig);
    expect(status.statusText).toBe("Alerts channel not set");
    expect(status.isConfigured).toBe(false);
  });

  test("automod: isConfigured true when only a detection toggle is on, even with no alerts channel", () => {
    const config = defaultConfig.clone();
    config.moderationSettings.automodScamImageEnabled = true;

    const status = computeAutomodStatus(config);
    expect(status.statusText).toBe("Alerts channel not set");
    expect(status.isConfigured).toBe(true);
  });
});

describe("isEssentiallyUnconfigured", () => {
  test("true for a completely default config", () => {
    expect(isEssentiallyUnconfigured(defaultConfig)).toBe(true);
  });

  test("false once a logging channel is set", () => {
    const config = defaultConfig.clone();
    config.loggingSettings.modLogChannel = "111";
    expect(isEssentiallyUnconfigured(config)).toBe(false);
  });

  test("true when only Moderation's DM toggles differ from default (deliberately excluded)", () => {
    const config = defaultConfig.clone();
    config.moderationSettings.kickDmEnabled = true;
    config.moderationSettings.banDmEnabled = false;

    expect(isEssentiallyUnconfigured(config)).toBe(true);
  });
});

describe("SETTINGS_TAB_BY_CUSTOM_ID", () => {
  test("Overview's View › customIds all resolve to their target page", () => {
    expect(
      SETTINGS_TAB_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_LOGGING),
    ).toBe("logging");
    expect(
      SETTINGS_TAB_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MODERATION,
      ),
    ).toBe("moderation");
    expect(
      SETTINGS_TAB_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MOD_DMS),
    ).toBe("mod-dms");
    expect(
      SETTINGS_TAB_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_LOOKUP),
    ).toBe("lookup");
    expect(
      SETTINGS_TAB_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MESSAGES),
    ).toBe("messages");
    expect(
      SETTINGS_TAB_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_AUTOMOD),
    ).toBe("automod");
  });
});
