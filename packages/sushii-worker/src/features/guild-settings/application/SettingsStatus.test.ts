import { describe, expect, test } from "bun:test";

import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { ChannelHealth, RowState } from "./SettingsStatus";
import { computeSettingsStatus } from "./SettingsStatus";

const GUILD_ID = "123456789012345678";
const OK_CHANNEL = "234567890123456781";
const DELETED_CHANNEL = "234567890123456782";
const NO_PERMS_CHANNEL = "234567890123456783";
const UNCHECKED_CHANNEL = "234567890123456784";
const NO_EMBED_CHANNEL = "234567890123456785";
const ROLE_ID = "345678901234567890";

const MISSING_PERMS = ["Send Messages", "Embed Links"];

const HEALTH: ReadonlyMap<string, ChannelHealth> = new Map<
  string,
  ChannelHealth
>([
  [OK_CHANNEL, { kind: "ok" }],
  [DELETED_CHANNEL, { kind: "missing_channel" }],
  [
    NO_PERMS_CHANNEL,
    { kind: "missing_permissions", permissions: MISSING_PERMS },
  ],
  [
    NO_EMBED_CHANNEL,
    { kind: "missing_permissions", permissions: ["Embed Links"] },
  ],
]);

const ON: RowState = { kind: "on" };
const OFF: RowState = { kind: "off" };
const NOT_SET: RowState = { kind: "not_set" };
const DELETED: RowState = {
  kind: "attention",
  problem: { kind: "missing_channel" },
};
const NO_PERMS: RowState = {
  kind: "attention",
  problem: { kind: "missing_permissions", permissions: MISSING_PERMS },
};
const WELCOME_NO_PERMS: RowState = {
  kind: "attention",
  problem: { kind: "missing_permissions", permissions: ["Send Messages"] },
};
const NEEDS_MOD_LOG: RowState = {
  kind: "attention",
  problem: { kind: "needs_mod_log" },
};

interface Overrides {
  messageSettings?: Partial<GuildConfig["messageSettings"]>;
  loggingSettings?: Partial<GuildConfig["loggingSettings"]>;
  moderationSettings?: Partial<GuildConfig["moderationSettings"]>;
}

function makeConfig(overrides: Overrides = {}): GuildConfig {
  const base = GuildConfig.createDefault(GUILD_ID);
  return new GuildConfig(
    GUILD_ID,
    null,
    { ...base.messageSettings, ...overrides.messageSettings },
    { ...base.loggingSettings, ...overrides.loggingSettings },
    { ...base.moderationSettings, ...overrides.moderationSettings },
    [],
  );
}

function compute(
  overrides: Overrides = {},
  screening: ScreeningSettingsState | null = null,
) {
  return computeSettingsStatus({
    config: makeConfig(overrides),
    screening,
    channelHealth: HEALTH,
  });
}

describe("computeSettingsStatus", () => {
  describe("logging", () => {
    const logs = [
      { row: "modlog", channel: "modLogChannel", enabled: "modLogEnabled" },
      {
        row: "memberlog",
        channel: "memberLogChannel",
        enabled: "memberLogEnabled",
      },
      {
        row: "msglog",
        channel: "messageLogChannel",
        enabled: "messageLogEnabled",
      },
      {
        row: "reactionlog",
        channel: "reactionLogChannel",
        enabled: "reactionLogEnabled",
      },
    ] as const;

    const cases = [
      {
        name: "enabled without channel",
        channel: null,
        enabled: true,
        expected: OFF,
      },
      {
        name: "disabled with channel",
        channel: OK_CHANNEL,
        enabled: false,
        expected: OFF,
      },
      {
        name: "disabled with deleted channel",
        channel: DELETED_CHANNEL,
        enabled: false,
        expected: OFF,
      },
      {
        name: "enabled with healthy channel",
        channel: OK_CHANNEL,
        enabled: true,
        expected: ON,
      },
      {
        name: "enabled with unchecked channel",
        channel: UNCHECKED_CHANNEL,
        enabled: true,
        expected: ON,
      },
      {
        name: "enabled with deleted channel",
        channel: DELETED_CHANNEL,
        enabled: true,
        expected: DELETED,
      },
      {
        name: "enabled with missing permissions",
        channel: NO_PERMS_CHANNEL,
        enabled: true,
        expected: NO_PERMS,
      },
    ];

    for (const log of logs) {
      test.each(cases)(
        `${log.row}: $name`,
        ({ channel, enabled, expected }) => {
          const status = compute({
            loggingSettings: { [log.channel]: channel, [log.enabled]: enabled },
          });

          expect(status.logging[log.row]).toEqual(expected);
        },
      );
    }
  });

  describe("moderation", () => {
    test.each([
      { command: true, native: false, modLog: "on", expected: ON },
      { command: false, native: true, modLog: "on", expected: ON },
      { command: true, native: true, modLog: "on", expected: ON },
      { command: false, native: false, modLog: "on", expected: OFF },
      { command: true, native: false, modLog: "unset", expected: ON },
      { command: false, native: false, modLog: "unset", expected: OFF },
      {
        command: false,
        native: true,
        modLog: "unset",
        expected: NEEDS_MOD_LOG,
      },
      { command: true, native: true, modLog: "unset", expected: NEEDS_MOD_LOG },
      {
        command: false,
        native: true,
        modLog: "disabled",
        expected: NEEDS_MOD_LOG,
      },
      { command: false, native: true, modLog: "deleted", expected: ON },
    ] as const)(
      "dm-timeout command=$command native=$native modLog=$modLog",
      ({ command, native, modLog, expected }) => {
        const modLogChannels = {
          on: OK_CHANNEL,
          unset: null,
          disabled: OK_CHANNEL,
          deleted: DELETED_CHANNEL,
        };
        const status = compute({
          loggingSettings: {
            modLogChannel: modLogChannels[modLog],
            modLogEnabled: modLog !== "disabled",
          },
          moderationSettings: {
            timeoutCommandDmEnabled: command,
            timeoutNativeDmEnabled: native,
          },
        });

        expect(status.moderation["dm-timeout"]).toEqual(expected);
        expect(status.attention.some((i) => i.row === "dm-timeout")).toBe(
          false,
        );
        expect(status.tabAttention.moderation).toBe(false);
      },
    );

    test("dm-warn is always on", () => {
      expect(compute().moderation["dm-warn"]).toEqual(ON);
    });

    test.each([
      { enabled: true, expected: ON },
      { enabled: false, expected: OFF },
    ])(
      "dm-ban, dm-kick and lookup enabled=$enabled",
      ({ enabled, expected }) => {
        const status = compute({
          moderationSettings: {
            banDmEnabled: enabled,
            kickDmEnabled: enabled,
            lookupDetailsOptIn: enabled,
          },
        });

        expect(status.moderation["dm-ban"]).toEqual(expected);
        expect(status.moderation["dm-kick"]).toEqual(expected);
        expect(status.moderation.lookup).toEqual(expected);
      },
    );
  });

  describe("automod", () => {
    test.each([
      { enabled: true, expected: ON },
      { enabled: false, expected: OFF },
    ])("scam and spam enabled=$enabled", ({ enabled, expected }) => {
      const status = compute({
        moderationSettings: {
          automodScamImageEnabled: enabled,
          automodSpamEnabled: enabled,
        },
      });

      expect(status.automod.scam).toEqual(expected);
      expect(status.automod.spam).toEqual(expected);
    });

    test.each([
      { name: "empty", roles: [], expected: NOT_SET },
      { name: "set", roles: [ROLE_ID], expected: ON },
    ])("exempt roles $name", ({ roles, expected }) => {
      const status = compute({
        moderationSettings: { automodExemptRoleIds: roles },
      });

      expect(status.automod.exempt).toEqual(expected);
    });

    test.each<{ name: string; channel: string | null; expected: RowState }>([
      { name: "unset", channel: null, expected: NOT_SET },
      { name: "healthy", channel: OK_CHANNEL, expected: ON },
      { name: "deleted", channel: DELETED_CHANNEL, expected: DELETED },
      {
        name: "missing permissions",
        channel: NO_PERMS_CHANNEL,
        expected: NO_PERMS,
      },
      {
        name: "missing only embed links",
        channel: NO_EMBED_CHANNEL,
        expected: {
          kind: "attention",
          problem: {
            kind: "missing_permissions",
            permissions: ["Embed Links"],
          },
        },
      },
    ])("alerts $name", ({ channel, expected }) => {
      const status = compute({
        moderationSettings: { automodAlertsChannelId: channel },
      });

      expect(status.automod.alerts).toEqual(expected);
    });

    test("screening is null when the flag is off", () => {
      expect(compute({}, null).automod.screening).toBeNull();
    });

    test.each([
      {
        name: "enabled with channel",
        enabled: true,
        channel: OK_CHANNEL,
        expected: ON,
      },
      {
        name: "enabled without channel",
        enabled: true,
        channel: null,
        expected: OFF,
      },
      {
        name: "disabled with channel",
        enabled: false,
        channel: OK_CHANNEL,
        expected: OFF,
      },
      {
        name: "disabled without channel",
        enabled: false,
        channel: null,
        expected: OFF,
      },
      {
        name: "disabled with deleted channel",
        enabled: false,
        channel: DELETED_CHANNEL,
        expected: OFF,
      },
      {
        name: "disabled with missing permissions",
        enabled: false,
        channel: NO_PERMS_CHANNEL,
        expected: OFF,
      },
      {
        name: "enabled with unchecked channel",
        enabled: true,
        channel: UNCHECKED_CHANNEL,
        expected: ON,
      },
      {
        name: "enabled with deleted channel",
        enabled: true,
        channel: DELETED_CHANNEL,
        expected: DELETED,
      },
      {
        name: "enabled with missing permissions",
        enabled: true,
        channel: NO_PERMS_CHANNEL,
        expected: NO_PERMS,
      },
    ])("screening $name", ({ enabled, channel, expected }) => {
      const status = compute(
        {},
        { enabled, logChannelId: channel, checkAvatars: true },
      );

      expect(status.automod.screening).toEqual(expected);
    });
  });

  describe("welcome", () => {
    test.each([
      { name: "unset", channel: null, expected: NOT_SET },
      { name: "healthy", channel: OK_CHANNEL, expected: ON },
      { name: "deleted", channel: DELETED_CHANNEL, expected: DELETED },
      {
        name: "missing permissions ignores embed links",
        channel: NO_PERMS_CHANNEL,
        expected: WELCOME_NO_PERMS,
      },
      {
        name: "missing only embed links",
        channel: NO_EMBED_CHANNEL,
        expected: ON,
      },
    ])("welcome-channel $name", ({ channel, expected }) => {
      const status = compute({ messageSettings: { messageChannel: channel } });

      expect(status.welcome["welcome-channel"]).toEqual(expected);
    });

    const messageCases: {
      name: string;
      enabled: boolean;
      channel: string | null;
      text: string | null;
      expected: RowState;
    }[] = [
      {
        name: "disabled",
        enabled: false,
        channel: OK_CHANNEL,
        text: "hi",
        expected: OFF,
      },
      {
        name: "disabled without channel or text",
        enabled: false,
        channel: null,
        text: null,
        expected: OFF,
      },
      {
        name: "enabled with channel and text",
        enabled: true,
        channel: OK_CHANNEL,
        text: "hi",
        expected: ON,
      },
      {
        name: "enabled without channel",
        enabled: true,
        channel: null,
        text: "hi",
        expected: { kind: "attention", problem: { kind: "no_channel" } },
      },
      {
        name: "enabled without text",
        enabled: true,
        channel: OK_CHANNEL,
        text: null,
        expected: OFF,
      },
      {
        name: "enabled without channel or text",
        enabled: true,
        channel: null,
        text: null,
        expected: OFF,
      },
      {
        name: "enabled with deleted channel and no text",
        enabled: true,
        channel: DELETED_CHANNEL,
        text: null,
        expected: OFF,
      },
      {
        name: "enabled with whitespace text",
        enabled: true,
        channel: OK_CHANNEL,
        text: "  ",
        expected: OFF,
      },
      {
        name: "enabled with deleted channel",
        enabled: true,
        channel: DELETED_CHANNEL,
        text: "hi",
        expected: DELETED,
      },
      {
        name: "enabled with missing permissions",
        enabled: true,
        channel: NO_PERMS_CHANNEL,
        text: "hi",
        expected: WELCOME_NO_PERMS,
      },
      {
        name: "enabled with only embed links missing",
        enabled: true,
        channel: NO_EMBED_CHANNEL,
        text: "hi",
        expected: ON,
      },
    ];

    test.each(messageCases)(
      "join $name",
      ({ enabled, channel, text, expected }) => {
        const status = compute({
          messageSettings: {
            messageChannel: channel,
            joinMessageEnabled: enabled,
            joinMessage: text,
          },
        });

        expect(status.welcome.join).toEqual(expected);
      },
    );

    test.each(messageCases)(
      "leave $name",
      ({ enabled, channel, text, expected }) => {
        const status = compute({
          messageSettings: {
            messageChannel: channel,
            leaveMessageEnabled: enabled,
            leaveMessage: text,
          },
        });

        expect(status.welcome.leave).toEqual(expected);
      },
    );
  });

  describe("attention", () => {
    test("default guild has no attention items or tab warnings", () => {
      const status = computeSettingsStatus({
        config: GuildConfig.createDefault(GUILD_ID),
        screening: null,
        channelHealth: HEALTH,
      });

      expect(status.welcome).toEqual({
        "welcome-channel": NOT_SET,
        join: OFF,
        leave: OFF,
      });
      expect(status.moderation["dm-timeout"]).toEqual(NEEDS_MOD_LOG);
      expect(status.attention).toEqual([]);
      expect(status.tabAttention).toEqual({
        overview: false,
        logging: false,
        moderation: false,
        automod: false,
        welcome: false,
      });
    });

    test("a broken welcome channel yields one item for the channel row", () => {
      const status = compute({
        messageSettings: {
          messageChannel: DELETED_CHANNEL,
          joinMessageEnabled: true,
          joinMessage: "hi",
          leaveMessageEnabled: true,
          leaveMessage: "bye",
        },
      });

      expect(status.welcome).toEqual({
        "welcome-channel": DELETED,
        join: DELETED,
        leave: DELETED,
      });
      expect(status.attention.filter((i) => i.tab === "welcome")).toEqual([
        {
          tab: "welcome",
          row: "welcome-channel",
          problem: { kind: "missing_channel" },
        },
      ]);
      expect(status.tabAttention.welcome).toBe(true);
    });

    test("a welcome channel missing permissions yields one item", () => {
      const status = compute({
        messageSettings: {
          messageChannel: NO_PERMS_CHANNEL,
          joinMessageEnabled: true,
          joinMessage: "hi",
          leaveMessageEnabled: true,
          leaveMessage: "bye",
        },
      });

      expect(status.welcome).toEqual({
        "welcome-channel": WELCOME_NO_PERMS,
        join: WELCOME_NO_PERMS,
        leave: WELCOME_NO_PERMS,
      });
      expect(status.attention.filter((i) => i.tab === "welcome")).toEqual([
        {
          tab: "welcome",
          row: "welcome-channel",
          problem: {
            kind: "missing_permissions",
            permissions: ["Send Messages"],
          },
        },
      ]);
    });

    test("a broken welcome channel with join and leave off adds no item", () => {
      const status = compute({
        messageSettings: {
          messageChannel: DELETED_CHANNEL,
          joinMessageEnabled: false,
          leaveMessageEnabled: false,
        },
      });

      expect(status.welcome["welcome-channel"]).toEqual(DELETED);
      expect(status.attention.filter((i) => i.tab === "welcome")).toEqual([]);
      expect(status.tabAttention.welcome).toBe(false);
    });

    test.each([
      { scam: false, spam: false, item: false },
      { scam: true, spam: false, item: true },
      { scam: false, spam: true, item: true },
    ])(
      "broken alerts channel scam=$scam spam=$spam adds item=$item",
      ({ scam, spam, item }) => {
        const status = compute({
          moderationSettings: {
            automodAlertsChannelId: DELETED_CHANNEL,
            automodScamImageEnabled: scam,
            automodSpamEnabled: spam,
          },
        });

        expect(status.automod.alerts).toEqual(DELETED);
        expect(status.attention.some((i) => i.row === "alerts")).toBe(item);
        expect(status.tabAttention.automod).toBe(item);
      },
    );

    test("join and leave each report no_channel when the channel is unset", () => {
      const status = compute({
        messageSettings: {
          messageChannel: null,
          joinMessageEnabled: true,
          joinMessage: "hi",
          leaveMessageEnabled: true,
          leaveMessage: "bye",
        },
      });

      expect(status.attention.filter((i) => i.tab === "welcome")).toEqual([
        { tab: "welcome", row: "join", problem: { kind: "no_channel" } },
        { tab: "welcome", row: "leave", problem: { kind: "no_channel" } },
      ]);
    });

    const healthy: Overrides = {
      loggingSettings: { modLogChannel: OK_CHANNEL, modLogEnabled: true },
      messageSettings: {
        messageChannel: OK_CHANNEL,
        joinMessageEnabled: false,
        leaveMessageEnabled: false,
      },
    };

    test("no attention when everything is healthy", () => {
      const status = compute(healthy, {
        enabled: true,
        logChannelId: OK_CHANNEL,
        checkAvatars: true,
      });

      expect(status.attention).toEqual([]);
      expect(status.tabAttention).toEqual({
        overview: false,
        logging: false,
        moderation: false,
        automod: false,
        welcome: false,
      });
    });

    test("lists items in tab order, then row order", () => {
      const status = compute(
        {
          loggingSettings: {
            modLogChannel: OK_CHANNEL,
            modLogEnabled: true,
            memberLogChannel: DELETED_CHANNEL,
            memberLogEnabled: true,
            messageLogChannel: null,
            messageLogEnabled: true,
            reactionLogChannel: NO_PERMS_CHANNEL,
            reactionLogEnabled: true,
          },
          moderationSettings: {
            automodAlertsChannelId: DELETED_CHANNEL,
            automodScamImageEnabled: true,
          },
          messageSettings: {
            messageChannel: null,
            joinMessageEnabled: false,
            leaveMessageEnabled: true,
            leaveMessage: "bye",
          },
        },
        { enabled: true, logChannelId: NO_PERMS_CHANNEL, checkAvatars: false },
      );

      expect(status.attention).toEqual([
        {
          tab: "logging",
          row: "memberlog",
          problem: { kind: "missing_channel" },
        },
        {
          tab: "logging",
          row: "reactionlog",
          problem: { kind: "missing_permissions", permissions: MISSING_PERMS },
        },
        {
          tab: "automod",
          row: "screening",
          problem: { kind: "missing_permissions", permissions: MISSING_PERMS },
        },
        { tab: "automod", row: "alerts", problem: { kind: "missing_channel" } },
        { tab: "welcome", row: "leave", problem: { kind: "no_channel" } },
      ]);
      expect(status.tabAttention).toEqual({
        overview: true,
        logging: true,
        moderation: false,
        automod: true,
        welcome: true,
      });
    });

    test("overview flags attention from a single tab", () => {
      const status = compute({
        ...healthy,
        loggingSettings: {
          modLogChannel: DELETED_CHANNEL,
          modLogEnabled: true,
        },
      });

      expect(status.attention).toEqual([
        { tab: "logging", row: "modlog", problem: { kind: "missing_channel" } },
      ]);
      expect(status.tabAttention).toEqual({
        overview: true,
        logging: true,
        moderation: false,
        automod: false,
        welcome: false,
      });
    });
  });
});
