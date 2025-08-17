import { beforeEach, describe, expect, test } from "bun:test";
import type { GuildMember, User } from "discord.js";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import {
  BanAction,
  KickAction,
  NoteAction,
  TimeoutAction,
  UnbanAction,
  WarnAction,
} from "../../shared/domain/entities/ModerationAction";
import { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import { Duration } from "../../shared/domain/value-objects/Duration";
import { Reason } from "../../shared/domain/value-objects/Reason";
import { DMPolicyService } from "./DMPolicyService";

// Mock implementations
class MockGuildConfigRepository implements GuildConfigRepository {
  private banDmEnabled = true;
  private timeoutCommandDmEnabled = true;

  async findByGuildId(guildId: string): Promise<GuildConfig> {
    const config = GuildConfig.createDefault(guildId);
    config.moderationSettings.banDmEnabled = this.banDmEnabled;
    config.moderationSettings.timeoutCommandDmEnabled =
      this.timeoutCommandDmEnabled;
    return config;
  }

  setBanDmEnabled(enabled: boolean): void {
    this.banDmEnabled = enabled;
  }

  setTimeoutCommandDmEnabled(enabled: boolean): void {
    this.timeoutCommandDmEnabled = enabled;
  }

  async save(configuration: GuildConfig): Promise<GuildConfig> {
    // Mock save implementation
    return configuration;
  }
}

// Mock factories
function createMockUser(): User {
  return {
    id: "123456789",
    tag: "TestUser#1234",
  } as User;
}

function createMockMember(): GuildMember {
  return {
    id: "123456789",
    user: createMockUser(),
  } as GuildMember;
}

function createMockTarget(hasMember: boolean = true): ModerationTarget {
  return new ModerationTarget(
    createMockUser(),
    hasMember ? createMockMember() : null,
  );
}

function createMockReason(): Reason {
  const result = Reason.create("Test reason");
  if (!result.ok) {
    throw new Error("Failed to create reason");
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return result.val!;
}

function createMockDuration(): Duration {
  const result = Duration.create("1d");
  if (!result.ok) {
    throw new Error("Failed to create duration");
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return result.val!;
}

function createMockGuildConfig(guildId: string = "guild123"): GuildConfig {
  return GuildConfig.createDefault(guildId);
}

describe("DMPolicyService", () => {
  const mockGuildId = "123456789";
  let dmPolicyService: DMPolicyService;
  let mockGuildConfigRepository: MockGuildConfigRepository;

  beforeEach(() => {
    mockGuildConfigRepository = new MockGuildConfigRepository();
    dmPolicyService = new DMPolicyService(mockGuildConfigRepository);
  });

  describe("basic eligibility checks", () => {
    test("returns false when target has no member", async () => {
      const target = createMockTarget(false); // No member
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });

    test("returns false for unsupported action types", async () => {
      const target = createMockTarget(true);
      const action = new NoteAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });
  });

  describe("timing rules", () => {
    test("returns false for non-ban actions with 'before' timing", async () => {
      const target = createMockTarget(true);
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });

    test("returns false for ban actions with 'after' timing", async () => {
      const target = createMockTarget(true);
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });

    test("returns true for ban actions with 'before' timing", async () => {
      const target = createMockTarget(true);
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(true);
    });
  });

  describe("reason requirement", () => {
    test("returns false when no reason provided", async () => {
      const target = createMockTarget(true);
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        null, // reason
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });
  });

  describe("warn action special case", () => {
    test("returns true for warn actions regardless of other settings", async () => {
      const target = createMockTarget(true);
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(true);
    });
  });

  describe("DM choice override", () => {
    test("returns true when dmChoice is 'yes_dm'", async () => {
      const target = createMockTarget(true);
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "yes_dm",
      );

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(true);
    });

    test("returns false when dmChoice is 'no_dm'", async () => {
      const target = createMockTarget(true);
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "no_dm",
      );

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });
  });

  describe("UnbanAction special case", () => {
    test("returns false for UnbanAction actions", async () => {
      const target = createMockTarget(true);
      const action = new UnbanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });
  });

  describe("guild settings fallback", () => {
    test("uses guild ban DM setting for ban actions", async () => {
      const target = createMockTarget(true);
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      // Test with ban DM enabled
      mockGuildConfigRepository.setBanDmEnabled(true);
      let guildConfig =
        await mockGuildConfigRepository.findByGuildId(mockGuildId);
      let result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        guildConfig,
      );
      expect(result.should).toBe(true);

      // Test with ban DM disabled
      mockGuildConfigRepository.setBanDmEnabled(false);
      guildConfig = await mockGuildConfigRepository.findByGuildId(mockGuildId);
      result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        guildConfig,
      );
      expect(result.should).toBe(false);
    });

    test("uses guild timeout DM setting for timeout actions", async () => {
      const target = createMockTarget(true);
      const action = new TimeoutAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
        null,
        createMockDuration(),
      );

      // Test with timeout DM enabled
      mockGuildConfigRepository.setTimeoutCommandDmEnabled(true);
      let guildConfig =
        await mockGuildConfigRepository.findByGuildId(mockGuildId);
      let result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        guildConfig,
      );
      expect(result.should).toBe(true);

      // Test with timeout DM disabled
      mockGuildConfigRepository.setTimeoutCommandDmEnabled(false);
      guildConfig = await mockGuildConfigRepository.findByGuildId(mockGuildId);
      result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        guildConfig,
      );
      expect(result.should).toBe(false);
    });

    test("defaults to false for kick action types (no config yet)", async () => {
      const target = createMockTarget(true);
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(),
        "unspecified",
      );

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        createMockGuildConfig(),
      );

      expect(result.should).toBe(false);
    });
  });

  describe("custom DM text behavior", () => {
    test("sends DM when custom ban text is configured but no reason provided", async () => {
      const target = createMockTarget(true);
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        null, // no reason
        "unspecified",
        null,
      );

      // Create guild config with custom ban text
      const guildConfig = createMockGuildConfig();
      guildConfig.moderationSettings.banDmText = "Custom ban message";

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        guildConfig,
      );

      expect(result.should).toBe(true);
    });

    test("sends DM when custom timeout text is configured but no reason provided", async () => {
      const target = createMockTarget(true);
      const action = new TimeoutAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        null, // no reason
        "unspecified",
        null,
        createMockDuration(),
      );

      // Create guild config with custom timeout text
      const guildConfig = createMockGuildConfig();
      guildConfig.moderationSettings.timeoutDmText = "Custom timeout message";

      const result = await dmPolicyService.shouldSendDM(
        "after",
        action,
        target,
        guildConfig,
      );

      expect(result.should).toBe(true);
    });

    test("sends DM when custom warn text is configured but no reason provided", async () => {
      const target = createMockTarget(true);
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        null, // no reason
        "unspecified",
        null,
      );

      // Create guild config with custom warn text
      const guildConfig = createMockGuildConfig();
      guildConfig.moderationSettings.warnDmText = "Custom warn message";

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        guildConfig,
      );

      expect(result.should).toBe(true);
    });

    test("does not send DM when neither reason nor custom text provided", async () => {
      const target = createMockTarget(true);
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        null, // no reason
        "unspecified",
        null,
      );

      // Create guild config without custom ban text
      const guildConfig = createMockGuildConfig();
      guildConfig.moderationSettings.banDmText = null;

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        guildConfig,
      );

      expect(result.should).toBe(false);
    });

    test("sends DM when both reason and custom text are provided", async () => {
      const target = createMockTarget(true);
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null, // executorMember
        createMockReason(), // has reason
        "unspecified",
        null,
      );

      // Create guild config with custom ban text
      const guildConfig = createMockGuildConfig();
      guildConfig.moderationSettings.banDmText = "Custom ban message";

      const result = await dmPolicyService.shouldSendDM(
        "before",
        action,
        target,
        guildConfig,
      );

      expect(result.should).toBe(true);
    });
  });
});
