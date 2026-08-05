import { describe, expect, test } from "bun:test";

import {
  MODAL_TARGET_PAGE_BY_CUSTOM_ID,
  SETTINGS_CUSTOM_IDS,
  TOGGLE_SETTING_PAGE_BY_CUSTOM_ID,
} from "./SettingsConstants";

describe("MODAL_TARGET_PAGE_BY_CUSTOM_ID", () => {
  test("every registered modal customId has a target page", () => {
    for (const customId of Object.values(SETTINGS_CUSTOM_IDS.MODALS)) {
      expect(MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(customId)).toBeDefined();
    }
  });

  test("maps each modal to the expected page", () => {
    expect(
      MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE,
      ),
    ).toBe("messages");
    expect(
      MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE,
      ),
    ).toBe("messages");
    expect(
      MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT,
      ),
    ).toBe("mod-dms");
    expect(
      MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT,
      ),
    ).toBe("mod-dms");
    expect(
      MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT,
      ),
    ).toBe("mod-dms");
    expect(
      MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT,
      ),
    ).toBe("mod-dms");
  });
});

describe("TOGGLE_SETTING_PAGE_BY_CUSTOM_ID", () => {
  test("every registered toggle customId has a setting/page mapping", () => {
    for (const customId of Object.values(SETTINGS_CUSTOM_IDS.TOGGLES)) {
      expect(TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(customId)).toBeDefined();
    }
  });

  test("maps each toggle to the expected setting and page", () => {
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.TOGGLES.MOD_LOG),
    ).toEqual({ setting: "modLog", page: "logging" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.MEMBER_LOG,
      ),
    ).toEqual({ setting: "memberLog", page: "logging" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.MESSAGE_LOG,
      ),
    ).toEqual({ setting: "messageLog", page: "logging" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.REACTION_LOG,
      ),
    ).toEqual({ setting: "reactionLog", page: "logging" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.JOIN_MSG,
      ),
    ).toEqual({ setting: "joinMessage", page: "messages" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.LEAVE_MSG,
      ),
    ).toEqual({ setting: "leaveMessage", page: "messages" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.LOOKUP_OPT_IN,
      ),
    ).toEqual({ setting: "lookupOptIn", page: "lookup" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_COMMAND_DM,
      ),
    ).toEqual({ setting: "timeoutCommandDm", page: "moderation" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_NATIVE_DM,
      ),
    ).toEqual({ setting: "timeoutNativeDm", page: "moderation" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.TOGGLES.BAN_DM),
    ).toEqual({ setting: "banDm", page: "moderation" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(SETTINGS_CUSTOM_IDS.TOGGLES.KICK_DM),
    ).toEqual({ setting: "kickDm", page: "moderation" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
      ),
    ).toEqual({ setting: "automodSpam", page: "automod" });
    expect(
      TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(
        SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SCAM_IMAGE,
      ),
    ).toEqual({ setting: "automodScamImage", page: "automod" });
  });
});
