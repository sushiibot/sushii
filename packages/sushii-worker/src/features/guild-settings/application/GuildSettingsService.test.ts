import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { GuildSettingsService } from "./GuildSettingsService";
import type { GuildSettingsPatch, LogType } from "./SettingsPatch";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const ROLE_A = "400000000000000001";
const ROLE_B = "400000000000000002";

function setup(initial: GuildConfig = GuildConfig.createDefault(GUILD)) {
  let stored = initial;
  const repo = {
    findByGuildId: mock(async () => stored),
    save: mock(async (config: GuildConfig) => {
      stored = config;
      return config;
    }),
  } satisfies GuildConfigRepository;

  return {
    service: new GuildSettingsService(repo, pino({ level: "silent" })),
    repo,
    current: () => stored,
  };
}

const enabledKey = {
  mod: "modLogEnabled",
  member: "memberLogEnabled",
  message: "messageLogEnabled",
  reaction: "reactionLogEnabled",
} as const;

const channelKey = {
  mod: "modLogChannel",
  member: "memberLogChannel",
  message: "messageLogChannel",
  reaction: "reactionLogChannel",
} as const;

const logTypes: LogType[] = ["mod", "member", "message", "reaction"];

function withLog(log: LogType, channel: string | null, enabled: boolean) {
  const config = GuildConfig.createDefault(GUILD)
    .updateLogChannel(log, channel)
    .setLoggingEnabled(log, enabled);
  return config;
}

describe("GuildSettingsService.apply logChannel", () => {
  for (const log of logTypes) {
    test(`${log}: setting a channel turns a disabled log on`, async () => {
      const t = setup(withLog(log, null, false));

      const result = await t.service.apply(GUILD, {
        kind: "logChannel",
        log,
        channelId: CHANNEL,
      });

      expect(result.loggingSettings[channelKey[log]]).toBe(CHANNEL);
      expect(result.loggingSettings[enabledKey[log]]).toBe(true);
    });

    test(`${log}: clearing the channel turns the log off`, async () => {
      const t = setup(withLog(log, CHANNEL, true));

      const result = await t.service.apply(GUILD, {
        kind: "logChannel",
        log,
        channelId: null,
      });

      expect(result.loggingSettings[channelKey[log]]).toBeNull();
      expect(result.loggingSettings[enabledKey[log]]).toBe(false);
    });
  }

  test("leaves other logs untouched", async () => {
    const t = setup(
      GuildConfig.createDefault(GUILD)
        .updateLogChannel("member", CHANNEL)
        .setLoggingEnabled("member", false),
    );

    const result = await t.service.apply(GUILD, {
      kind: "logChannel",
      log: "mod",
      channelId: CHANNEL,
    });

    expect(result.loggingSettings.memberLogChannel).toBe(CHANNEL);
    expect(result.loggingSettings.memberLogEnabled).toBe(false);
  });
});

describe("GuildSettingsService.apply text and flag patches", () => {
  test("timeoutDm sets both flags and the text", async () => {
    const t = setup();

    const result = await t.service.apply(GUILD, {
      kind: "timeoutDm",
      commandEnabled: false,
      nativeEnabled: true,
      text: "you were timed out",
    });

    expect(result.moderationSettings.timeoutCommandDmEnabled).toBe(false);
    expect(result.moderationSettings.timeoutNativeDmEnabled).toBe(true);
    expect(result.moderationSettings.timeoutDmText).toBe("you were timed out");
  });

  test("warnDm sets and clears the text", async () => {
    const t = setup();

    const set = await t.service.apply(GUILD, {
      kind: "warnDm",
      text: "warned",
    });
    expect(set.moderationSettings.warnDmText).toBe("warned");

    const cleared = await t.service.apply(GUILD, {
      kind: "warnDm",
      text: null,
    });
    expect(cleared.moderationSettings.warnDmText).toBeNull();
  });

  test("banDm sets enabled and text together", async () => {
    const t = setup();

    const result = await t.service.apply(GUILD, {
      kind: "banDm",
      enabled: false,
      text: "banned",
    });

    expect(result.moderationSettings.banDmEnabled).toBe(false);
    expect(result.moderationSettings.banDmText).toBe("banned");
  });

  test("kickDm sets enabled and text together", async () => {
    const t = setup();

    const result = await t.service.apply(GUILD, {
      kind: "kickDm",
      enabled: true,
      text: "kicked",
    });

    expect(result.moderationSettings.kickDmEnabled).toBe(true);
    expect(result.moderationSettings.kickDmText).toBe("kicked");
  });

  test("joinMessage sets enabled and text together", async () => {
    const t = setup();

    const result = await t.service.apply(GUILD, {
      kind: "joinMessage",
      enabled: false,
      text: "hi <username>",
    });

    expect(result.messageSettings.joinMessageEnabled).toBe(false);
    expect(result.messageSettings.joinMessage).toBe("hi <username>");
  });

  test("leaveMessage sets enabled and text together", async () => {
    const t = setup();

    const result = await t.service.apply(GUILD, {
      kind: "leaveMessage",
      enabled: true,
      text: "bye",
    });

    expect(result.messageSettings.leaveMessageEnabled).toBe(true);
    expect(result.messageSettings.leaveMessage).toBe("bye");
  });

  test("null text clears every text field", async () => {
    const t = setup(
      GuildConfig.createDefault(GUILD)
        .updateTimeoutDmText("a")
        .updateBanDmText("b")
        .updateKickDmText("c")
        .updateJoinMessage("d")
        .updateLeaveMessage("e"),
    );

    await t.service.apply(GUILD, {
      kind: "timeoutDm",
      commandEnabled: true,
      nativeEnabled: true,
      text: null,
    });
    await t.service.apply(GUILD, { kind: "banDm", enabled: true, text: null });
    await t.service.apply(GUILD, { kind: "kickDm", enabled: true, text: null });
    await t.service.apply(GUILD, {
      kind: "joinMessage",
      enabled: true,
      text: null,
    });
    await t.service.apply(GUILD, {
      kind: "leaveMessage",
      enabled: true,
      text: null,
    });

    const { moderationSettings, messageSettings } = t.current();
    expect(moderationSettings.timeoutDmText).toBeNull();
    expect(moderationSettings.banDmText).toBeNull();
    expect(moderationSettings.kickDmText).toBeNull();
    expect(messageSettings.joinMessage).toBeNull();
    expect(messageSettings.leaveMessage).toBeNull();
  });

  test("whitespace-only text clears the field", async () => {
    const t = setup(GuildConfig.createDefault(GUILD).updateWarnDmText("w"));

    const result = await t.service.apply(GUILD, {
      kind: "warnDm",
      text: "   \n ",
    });

    expect(result.moderationSettings.warnDmText).toBeNull();
  });

  test("welcomeChannel sets and clears the channel", async () => {
    const t = setup();

    const set = await t.service.apply(GUILD, {
      kind: "welcomeChannel",
      channelId: CHANNEL,
    });
    expect(set.messageSettings.messageChannel).toBe(CHANNEL);

    const cleared = await t.service.apply(GUILD, {
      kind: "welcomeChannel",
      channelId: null,
    });
    expect(cleared.messageSettings.messageChannel).toBeNull();
  });

  test("automodExemptRoles replaces the role list", async () => {
    const t = setup(
      GuildConfig.createDefault(GUILD).setAutomodExemptRoles([ROLE_A]),
    );

    const result = await t.service.apply(GUILD, {
      kind: "automodExemptRoles",
      roleIds: [ROLE_B],
    });

    expect(result.moderationSettings.automodExemptRoleIds).toEqual([ROLE_B]);
  });

  test("automodExemptRoles drops the @everyone role", async () => {
    const t = setup();

    const result = await t.service.apply(GUILD, {
      kind: "automodExemptRoles",
      roleIds: [GUILD, ROLE_A],
    });

    expect(result.moderationSettings.automodExemptRoleIds).toEqual([ROLE_A]);
  });

  test("automodAlertsChannel sets and clears the channel", async () => {
    const t = setup();

    const set = await t.service.apply(GUILD, {
      kind: "automodAlertsChannel",
      channelId: CHANNEL,
    });
    expect(set.moderationSettings.automodAlertsChannelId).toBe(CHANNEL);

    const cleared = await t.service.apply(GUILD, {
      kind: "automodAlertsChannel",
      channelId: null,
    });
    expect(cleared.moderationSettings.automodAlertsChannelId).toBeNull();
  });

  test("flag patches set absolute values", async () => {
    const t = setup();

    await t.service.apply(GUILD, {
      kind: "flag",
      setting: "lookupOptIn",
      enabled: true,
    });
    await t.service.apply(GUILD, {
      kind: "flag",
      setting: "automodSpam",
      enabled: true,
    });
    await t.service.apply(GUILD, {
      kind: "flag",
      setting: "automodScamImage",
      enabled: true,
    });

    const { moderationSettings } = t.current();
    expect(moderationSettings.lookupDetailsOptIn).toBe(true);
    expect(moderationSettings.automodSpamEnabled).toBe(true);
    expect(moderationSettings.automodScamImageEnabled).toBe(true);
  });
});

describe("GuildSettingsService.apply idempotence", () => {
  const patches: GuildSettingsPatch[] = [
    { kind: "logChannel", log: "mod", channelId: CHANNEL },
    { kind: "logChannel", log: "message", channelId: null },
    {
      kind: "timeoutDm",
      commandEnabled: false,
      nativeEnabled: false,
      text: "t",
    },
    { kind: "warnDm", text: "w" },
    { kind: "banDm", enabled: false, text: null },
    { kind: "kickDm", enabled: true, text: "k" },
    { kind: "welcomeChannel", channelId: CHANNEL },
    { kind: "joinMessage", enabled: false, text: "j" },
    { kind: "leaveMessage", enabled: false, text: null },
    { kind: "automodExemptRoles", roleIds: [ROLE_A, ROLE_B] },
    { kind: "automodAlertsChannel", channelId: CHANNEL },
    { kind: "flag", setting: "lookupOptIn", enabled: true },
    { kind: "flag", setting: "automodSpam", enabled: false },
    { kind: "flag", setting: "automodScamImage", enabled: true },
  ];

  for (const patch of patches) {
    test(`applying ${JSON.stringify(patch)} twice is a no-op`, async () => {
      const t = setup();

      const first = await t.service.apply(GUILD, patch);
      const second = await t.service.apply(GUILD, patch);

      expect(second).toEqual(first);
      expect(t.repo.save).toHaveBeenCalledTimes(2);
    });
  }
});
