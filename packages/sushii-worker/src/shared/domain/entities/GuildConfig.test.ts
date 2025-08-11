import { describe, expect, it } from "bun:test";

import { GuildConfig } from "./GuildConfig";

describe("GuildConfig", () => {
  const mockGuildId = "123456789012345678";

  describe("deterministic setter methods", () => {
    it("should set join message enabled state explicitly", () => {
      const config = GuildConfig.createDefault(mockGuildId);

      // Default is true, set to false
      const disabledConfig = config.setJoinMessageEnabled(false);
      expect(disabledConfig.messageSettings.joinMessageEnabled).toBe(false);

      // Set back to true
      const enabledConfig = disabledConfig.setJoinMessageEnabled(true);
      expect(enabledConfig.messageSettings.joinMessageEnabled).toBe(true);
    });

    it("should set leave message enabled state explicitly", () => {
      const config = GuildConfig.createDefault(mockGuildId);

      const disabledConfig = config.setLeaveMessageEnabled(false);
      expect(disabledConfig.messageSettings.leaveMessageEnabled).toBe(false);

      const enabledConfig = disabledConfig.setLeaveMessageEnabled(true);
      expect(enabledConfig.messageSettings.leaveMessageEnabled).toBe(true);
    });

    it("should set logging enabled state explicitly for different types", () => {
      const config = GuildConfig.createDefault(mockGuildId);

      // Test mod log
      const disabledModLog = config.setModLogEnabled(false);
      expect(disabledModLog.loggingSettings.modLogEnabled).toBe(false);

      // Test member log
      const disabledMemberLog = config.setMemberLogEnabled(false);
      expect(disabledMemberLog.loggingSettings.memberLogEnabled).toBe(false);

      // Test message log
      const disabledMessageLog = config.setMessageLogEnabled(false);
      expect(disabledMessageLog.loggingSettings.messageLogEnabled).toBe(false);
    });

    it("should set generic logging enabled state explicitly", () => {
      const config = GuildConfig.createDefault(mockGuildId);

      const disabledMod = config.setLoggingEnabled("mod", false);
      expect(disabledMod.loggingSettings.modLogEnabled).toBe(false);

      const disabledMember = config.setLoggingEnabled("member", false);
      expect(disabledMember.loggingSettings.memberLogEnabled).toBe(false);

      const disabledMessage = config.setLoggingEnabled("message", false);
      expect(disabledMessage.loggingSettings.messageLogEnabled).toBe(false);
    });

    it("should set moderation settings enabled state explicitly", () => {
      const config = GuildConfig.createDefault(mockGuildId);

      // Test ban DM
      const disabledBanDm = config.setBanDmEnabled(false);
      expect(disabledBanDm.moderationSettings.banDmEnabled).toBe(false);

      // Test timeout DMs
      const disabledTimeoutCmd = config.setTimeoutCommandDmEnabled(false);
      expect(
        disabledTimeoutCmd.moderationSettings.timeoutCommandDmEnabled,
      ).toBe(false);

      const disabledTimeoutNative = config.setTimeoutNativeDmEnabled(false);
      expect(
        disabledTimeoutNative.moderationSettings.timeoutNativeDmEnabled,
      ).toBe(false);

      // Test lookup opt-in
      const enabledLookup = config.setLookupOptInEnabled(true);
      expect(enabledLookup.moderationSettings.lookupDetailsOptIn).toBe(true);
    });

    it("should maintain immutability - original config unchanged", () => {
      const originalConfig = GuildConfig.createDefault(mockGuildId);
      const originalJoinEnabled =
        originalConfig.messageSettings.joinMessageEnabled;

      const modifiedConfig =
        originalConfig.setJoinMessageEnabled(!originalJoinEnabled);

      // Original should be unchanged
      expect(originalConfig.messageSettings.joinMessageEnabled).toBe(
        originalJoinEnabled,
      );
      // Modified should have the new value
      expect(modifiedConfig.messageSettings.joinMessageEnabled).toBe(
        !originalJoinEnabled,
      );
    });

    it("should be deterministic - same input always produces same output", () => {
      const config = GuildConfig.createDefault(mockGuildId);

      // Multiple calls with same parameter should produce identical results
      const result1 = config.setJoinMessageEnabled(false);
      const result2 = config.setJoinMessageEnabled(false);

      expect(result1.messageSettings.joinMessageEnabled).toBe(
        result2.messageSettings.joinMessageEnabled,
      );
      expect(result1.messageSettings.joinMessageEnabled).toBe(false);
    });
  });
});
