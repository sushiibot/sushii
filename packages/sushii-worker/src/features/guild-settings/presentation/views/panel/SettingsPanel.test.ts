import { describe, expect, test } from "bun:test";
import { ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";

import type {
  AttentionItem,
  AttentionProblem,
  ChannelHealth,
  RowState,
  SettingsStatus,
} from "@/features/guild-settings/application/SettingsStatus";
import { computeSettingsStatus } from "@/features/guild-settings/application/SettingsStatus";
import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import Color from "@/utils/colors";

import type { SettingsTab } from "../../session/settingsIds";
import { SETTINGS_TABS } from "../../session/settingsIds";
import { ignoredText } from "./LoggingPanel";
import type { PanelEmojis, PanelInput } from "./SettingsPanel";
import { buildSettingsPanel } from "./SettingsPanel";
import type { MessagePreviewContext } from "./messagePreview";
import { quotedPreview, renderMessagePreview } from "./messagePreview";
import { attentionDetail } from "./panelParts";

const GUILD_ID = "1029384756102938000";
const CH = {
  mod: "1029384756102938400",
  member: "1029384756102938401",
  message: "1029384756102938402",
  reaction: "1029384756102938403",
  welcome: "1029384756102938404",
  alerts: "1029384756102938405",
  screening: "1029384756102938406",
  staff: "1029384756102938421",
  botspam: "1029384756102939000",
  memes: "1029384756102939001",
};
const ROLES = [
  "1029384756102938475",
  "1029384756102938476",
  "1029384756102938481",
];
const USER_ID = "150443906511667200";

const EMOJIS: PanelEmojis = {
  enabled: "<:enabled:1400000000000000001>",
  warning: "<:warning:1400000000000000002>",
  minus_silhouette: "<:minus_silhouette:1400000000000000003>",
  logs: "<:logs:1400000000000000004>",
  ban: "<:ban:1400000000000000005>",
  shield: "<:shield:1400000000000000006>",
  member_join: "<:member_join:1400000000000000007>",
};

const NO_EMOJIS = {} as PanelEmojis;

function typicalConfig(): GuildConfig {
  const config = GuildConfig.createDefault(GUILD_ID);
  const logs = config.loggingSettings;
  logs.modLogChannel = CH.mod;
  logs.memberLogChannel = CH.member;
  logs.messageLogChannel = CH.message;
  logs.reactionLogEnabled = false;

  const mod = config.moderationSettings;
  mod.timeoutDmText =
    "Please review the server rules. Contact a moderator via ModMail if you have questions.";
  mod.banDmText =
    "You can appeal this ban at https://forms.gle/onceloungeappeals within 30 days.";
  mod.lookupDetailsOptIn = true;
  mod.automodScamImageEnabled = true;
  mod.automodSpamEnabled = true;
  mod.automodExemptRoleIds = [...ROLES];
  mod.automodAlertsChannelId = CH.alerts;

  const msgs = config.messageSettings;
  msgs.messageChannel = CH.welcome;
  msgs.joinMessage =
    "Welcome <mention> to **<server>**! You are member #<member_number> 💚\nGrab roles in the role menu and say hi!";
  msgs.leaveMessageEnabled = false;
  return config;
}

const SCREENING: ScreeningSettingsState = {
  enabled: true,
  logChannelId: CH.screening,
  checkAvatars: true,
};

interface Fixture {
  config: GuildConfig;
  screening?: ScreeningSettingsState | null;
  health?: [string, ChannelHealth][];
}

function makeInput(
  tab: SettingsTab,
  fixture: Fixture,
  overrides: Partial<PanelInput> = {},
): PanelInput {
  const screening = fixture.screening ?? null;
  return {
    tab,
    config: fixture.config,
    status: computeSettingsStatus({
      config: fixture.config,
      screening,
      channelHealth: new Map(fixture.health ?? []),
    }),
    screening,
    ignoredChannelIds: [CH.botspam, CH.memes],
    emojis: EMOJIS,
    expired: false,
    preview: {
      userId: USER_ID,
      username: "nayeon",
      guildName: "ONCE Lounge",
      memberCount: 48213,
    },
    ...overrides,
  };
}

const typical = (): Fixture => ({ config: typicalConfig() });

const attentionFixture = (): Fixture => {
  const config = typicalConfig();
  config.loggingSettings.modLogChannel = CH.staff;
  return {
    config,
    health: [
      [
        CH.staff,
        {
          kind: "missing_permissions",
          permissions: ["Send Messages", "Embed Links"],
        },
      ],
    ],
  };
};

const fresh = (): Fixture => ({
  config: GuildConfig.createDefault(GUILD_ID),
});

interface JsonNode {
  type?: number;
  content?: string;
  components?: JsonNode[];
  accessory?: JsonNode;
  component?: JsonNode;
  [key: string]: unknown;
}

function toJson(input: PanelInput, footer?: ButtonBuilder): JsonNode {
  const payload = buildSettingsPanel(input, footer);
  expect(payload.components).toHaveLength(1);
  return payload.components[0].toJSON() as JsonNode;
}

function children(node: JsonNode): JsonNode[] {
  return [
    ...(node.components ?? []),
    ...(node.accessory ? [node.accessory] : []),
    ...(node.component ? [node.component] : []),
  ];
}

function shape(node: JsonNode): string {
  const kids = children(node);
  return kids.length > 0
    ? `${node.type}(${kids.map(shape).join(",")})`
    : `${node.type}`;
}

function countComponents(node: JsonNode): number {
  return 1 + children(node).reduce((n, kid) => n + countComponents(kid), 0);
}

function textLength(node: JsonNode): number {
  const own = node.type === 10 ? (node.content ?? "").length : 0;
  return own + children(node).reduce((n, kid) => n + textLength(kid), 0);
}

function allText(node: JsonNode): string {
  const own = node.type === 10 ? [node.content ?? ""] : [];
  return [...own, ...children(node).map(allText)].join("\n");
}

function buttons(node: JsonNode): JsonNode[] {
  const own = node.type === 2 ? [node] : [];
  return [...own, ...children(node).flatMap(buttons)];
}

function tabButtons(node: JsonNode): JsonNode[] {
  return children(children(node)[0]);
}

function feedbackButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("feedback/panel/settings")
    .setLabel("Feedback")
    .setStyle(ButtonStyle.Secondary);
}

const TABS = "1(2,2,2,2,2)";
const SEP = "14";
const ROW = "9(10,2)";
const FOOTER = ROW;

const DESIGN_SHAPES: Record<SettingsTab, string[]> = {
  overview: [TABS, SEP, "10", "10", SEP, FOOTER],
  logging: [TABS, SEP, ROW, ROW, ROW, ROW, SEP, FOOTER],
  moderation: [TABS, SEP, "10", ROW, ROW, ROW, ROW, SEP, ROW, SEP, FOOTER],
  automod: [TABS, SEP, ROW, ROW, SEP, ROW, ROW, SEP, FOOTER],
  welcome: [TABS, SEP, ROW, ROW, ROW, SEP, FOOTER],
};

describe("buildSettingsPanel", () => {
  test("returns a components v2 payload with no pings", () => {
    const payload = buildSettingsPanel(makeInput("overview", typical()));
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  describe("typical variants match the design structure", () => {
    for (const tab of SETTINGS_TABS) {
      test(tab, () => {
        const json = toJson(makeInput(tab, typical()), feedbackButton());
        expect(shape(json)).toBe(`17(${DESIGN_SHAPES[tab].join(",")})`);
      });
    }

    test("overview with attention adds the list and a separator", () => {
      const json = toJson(
        makeInput("overview", attentionFixture()),
        feedbackButton(),
      );
      expect(shape(json)).toBe(
        `17(${[TABS, SEP, "10", SEP, "10", "10", SEP, FOOTER].join(",")})`,
      );
    });

    test("automod with screening adds the screening row after spam", () => {
      const json = toJson(
        makeInput("automod", { config: typicalConfig(), screening: SCREENING }),
        feedbackButton(),
      );
      expect(shape(json)).toBe(
        `17(${[TABS, SEP, ROW, ROW, ROW, SEP, ROW, ROW, SEP, FOOTER].join(",")})`,
      );
      expect(allText(json)).toContain(
        `<:enabled:1400000000000000001> **Member screening** · Reviews in <#${CH.screening}> · checks avatars`,
      );
    });
  });

  describe("tab row", () => {
    test("active tab is primary and disabled, others secondary", () => {
      const tabs = tabButtons(toJson(makeInput("logging", typical())));
      expect(tabs.map((b) => b.custom_id)).toEqual(
        SETTINGS_TABS.map((t) => `settings:tab:${t}`),
      );
      expect(tabs.map((b) => [b.style, b.disabled ?? false])).toEqual([
        [ButtonStyle.Secondary, false],
        [ButtonStyle.Primary, true],
        [ButtonStyle.Secondary, false],
        [ButtonStyle.Secondary, false],
        [ButtonStyle.Secondary, false],
      ]);
    });

    test("category emojis, overview has none", () => {
      const tabs = tabButtons(toJson(makeInput("overview", typical())));
      expect(tabs.map((b) => (b.emoji as { name?: string })?.name)).toEqual([
        undefined,
        "logs",
        "ban",
        "shield",
        "member_join",
      ]);
    });

    test("tabs with attention swap to the warning emoji, overview stays bare", () => {
      const tabs = tabButtons(
        toJson(makeInput("overview", attentionFixture())),
      );
      expect(tabs.map((b) => (b.emoji as { name?: string })?.name)).toEqual([
        undefined,
        "warning",
        "ban",
        "shield",
        "member_join",
      ]);
    });

    test("expired: every tab secondary and disabled", () => {
      const tabs = tabButtons(
        toJson(makeInput("logging", typical(), { expired: true })),
      );
      for (const b of tabs) {
        expect(b.style).toBe(ButtonStyle.Secondary);
        expect(b.disabled).toBe(true);
      }
    });

    test("missing emojis leave tabs bare", () => {
      const tabs = tabButtons(
        toJson(
          makeInput("overview", attentionFixture(), { emojis: NO_EMOJIS }),
        ),
      );
      for (const b of tabs) {
        expect(b.emoji).toBeUndefined();
      }
    });
  });

  describe("overview", () => {
    test("typical", () => {
      const json = toJson(makeInput("overview", typical()));
      expect(json.accent_color).toBe(Color.Info);
      const content = children(json)[2].content;
      expect(content).toBe(
        [
          "<:enabled:1400000000000000001> **Logging** · 3 of 4 on",
          "<:enabled:1400000000000000001> **Moderation** · 3 of 4 DMs on · lookup sharing on",
          "<:enabled:1400000000000000001> **Automod** · Scam images and spam on",
          `<:enabled:1400000000000000001> **Welcome** · Join message on in <#${CH.welcome}>`,
        ].join("\n"),
      );
      expect(allText(json)).toContain(
        "-# More setup: `/levelrole` · `/rolemenu` · `/schedule-config` · `/tag-admin`",
      );
      expect(allText(json)).toContain(
        "-# Changes save automatically · expires after 5 minutes idle",
      );
    });

    test("needs attention", () => {
      const json = toJson(makeInput("overview", attentionFixture()));
      expect(json.accent_color).toBe(Color.Warning);
      expect(children(json)[2].content).toBe(
        [
          "<:warning:1400000000000000002> **Needs attention**",
          `- **Mod log** can't post in <#${CH.staff}>: needs Send Messages, Embed Links`,
        ].join("\n"),
      );
      expect(allText(json)).toContain(
        "<:warning:1400000000000000002> **Logging** · 3 of 4 on · 1 needs attention",
      );
    });

    test("fresh server shows no warning for row-only problems", () => {
      const input = makeInput("overview", fresh());
      expect(input.status.moderation["dm-timeout"].kind).toBe("attention");

      const json = toJson(input);
      expect(json.accent_color).toBe(Color.Info);
      expect(children(json)[2].content).toBe(
        [
          "<:minus_silhouette:1400000000000000003> **Logging** · None set up",
          "<:enabled:1400000000000000001> **Moderation** · 3 of 4 DMs on · lookup sharing off",
          "<:minus_silhouette:1400000000000000003> **Automod** · Off",
          "<:minus_silhouette:1400000000000000003> **Welcome** · Off",
        ].join("\n"),
      );
    });

    test("expired footer", () => {
      const json = toJson(makeInput("overview", typical(), { expired: true }));
      expect(allText(json)).toContain(
        "-# Expired after 5 minutes idle. Run `/settings` again to make changes.",
      );
      expect(allText(json)).not.toContain("Changes save automatically");
    });

    test("emoji-missing fallback uses unicode", () => {
      const json = toJson(
        makeInput("overview", attentionFixture(), { emojis: NO_EMOJIS }),
      );
      const text = allText(json);
      expect(text).toContain("⚠️ **Needs attention**");
      expect(text).toContain("⚠️ **Logging** · 3 of 4 on · 1 needs attention");
      expect(text).toContain("✅ **Moderation**");
    });
  });

  describe("logging", () => {
    test("typical", () => {
      const text = allText(toJson(makeInput("logging", typical())));
      expect(text).toContain(
        `<:enabled:1400000000000000001> **Mod log** · <#${CH.mod}>`,
      );
      expect(text).toContain(
        `<:enabled:1400000000000000001> **Message log** · <#${CH.message}>\n-# Ignoring <#${CH.botspam}>, <#${CH.memes}>`,
      );
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Reaction log** · Off",
      );
    });

    test("needs attention", () => {
      const json = toJson(makeInput("logging", attentionFixture()));
      expect(json.accent_color).toBe(Color.Warning);
      expect(allText(json)).toContain(
        `<:warning:1400000000000000002> **Mod log** · <#${CH.staff}>\n-# sushii can't post there: needs Send Messages, Embed Links`,
      );
    });

    test("deleted channel", () => {
      const config = typicalConfig();
      const text = allText(
        toJson(
          makeInput("logging", {
            config,
            health: [[CH.member, { kind: "missing_channel" }]],
          }),
        ),
      );
      expect(text).toContain(
        `-# <#${CH.member}> was deleted, pick a new channel`,
      );
    });

    test("fresh", () => {
      const json = toJson(makeInput("logging", fresh()));
      const text = allText(json);
      for (const name of [
        "Mod log",
        "Member log",
        "Message log",
        "Reaction log",
      ]) {
        expect(text).toContain(
          `<:minus_silhouette:1400000000000000003> **${name}** · Off`,
        );
      }
      const edits = buttons(json).filter((b) =>
        String(b.custom_id).startsWith("settings:edit:"),
      );
      expect(edits.map((b) => b.custom_id)).toEqual([
        "settings:edit:modlog",
        "settings:edit:memberlog",
        "settings:edit:msglog",
        "settings:edit:reactionlog",
      ]);
      for (const b of edits) {
        expect(b.label).toBe("Edit");
        expect(b.style).toBe(ButtonStyle.Secondary);
        expect(b.disabled ?? false).toBe(false);
      }
    });

    test("expired disables accessories", () => {
      const json = toJson(makeInput("logging", typical(), { expired: true }));
      const rowButtons = buttons(json).filter((b) =>
        String(b.custom_id).startsWith("settings:edit:"),
      );
      expect(rowButtons).toHaveLength(4);
      for (const b of rowButtons) {
        expect(b.disabled).toBe(true);
      }
    });

    test("emoji-missing fallback", () => {
      const text = allText(
        toJson(makeInput("logging", attentionFixture(), { emojis: NO_EMOJIS })),
      );
      expect(text).toContain(`⚠️ **Mod log** · <#${CH.staff}>`);
      expect(text).toContain(`✅ **Member log** · <#${CH.member}>`);
      expect(text).toContain("➖ **Reaction log** · Off");
    });
  });

  describe("moderation", () => {
    test("typical", () => {
      const json = toJson(makeInput("moderation", typical()));
      const text = allText(json);
      expect(text).toContain("**DMs sent to members**");
      expect(text).toContain(
        "<:enabled:1400000000000000001> **Timeout** · `/timeout` and right-click timeouts\n-# “Please review the server rules. Contact a moderator via ModMail…”",
      );
      expect(text).toContain(
        "<:enabled:1400000000000000001> **Warn** · Always sent\n-# Default text",
      );
      expect(text).toContain(
        "<:enabled:1400000000000000001> **Ban** · `/ban` only\n-# “You can appeal this ban at https://forms.gle/onceloungeappeals…”",
      );
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Kick** · Off",
      );
      expect(text).toContain(
        "<:enabled:1400000000000000001> **Lookup sharing** · Other servers see your server name and ban reasons in `/lookup`",
      );
      const lookup = buttons(json).find(
        (b) => b.custom_id === "settings:toggle:lookup",
      );
      expect(lookup?.label).toBe("Turn off");
      expect(lookup?.style).toBe(ButtonStyle.Secondary);
    });

    test("needs attention: right-click timeouts without a mod log", () => {
      const config = typicalConfig();
      config.loggingSettings.modLogChannel = null;
      const json = toJson(makeInput("moderation", { config }));
      expect(json.accent_color).toBe(Color.Info);
      expect(allText(json)).toContain(
        "<:warning:1400000000000000002> **Timeout** · `/timeout` and right-click timeouts\n-# Right-click timeouts need the mod log turned on\n-# “Please review",
      );
    });

    test("fresh", () => {
      const json = toJson(makeInput("moderation", fresh()));
      const text = allText(json);
      expect(text).toContain("**Ban** · `/ban` only");
      expect(text).not.toContain("“");
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Lookup sharing** · Off",
      );
      const lookup = buttons(json).find(
        (b) => b.custom_id === "settings:toggle:lookup",
      );
      expect(lookup?.label).toBe("Turn on");
    });

    test("expired", () => {
      const json = toJson(
        makeInput("moderation", typical(), { expired: true }),
      );
      for (const b of buttons(json)) {
        expect(b.disabled).toBe(true);
      }
    });

    test("emoji-missing fallback", () => {
      const text = allText(
        toJson(makeInput("moderation", typical(), { emojis: NO_EMOJIS })),
      );
      expect(text).toContain("✅ **Timeout**");
      expect(text).toContain("➖ **Kick** · Off");
    });
  });

  describe("automod", () => {
    test("typical", () => {
      const json = toJson(makeInput("automod", typical()));
      const text = allText(json);
      expect(text).toContain(
        "<:enabled:1400000000000000001> **Scam images** · Times out on a match",
      );
      expect(text).toContain(
        "<:enabled:1400000000000000001> **Spam** · Times out cross-channel spam",
      );
      expect(text).toContain(
        `\n**Exempt roles** · ${ROLES.map((r) => `<@&${r}>`).join(", ")}\n-# Skipped by scam images and spam`,
      );
      expect(text).toContain(
        `\n**Alerts channel** · <#${CH.alerts}>\n-# Actions are always logged in <#${CH.mod}>`,
      );
      expect(text).not.toContain("Member screening");
      const toggles = buttons(json).filter((b) =>
        String(b.custom_id).startsWith("settings:toggle:"),
      );
      expect(toggles.map((b) => [b.custom_id, b.label])).toEqual([
        ["settings:toggle:scam", "Turn off"],
        ["settings:toggle:spam", "Turn off"],
      ]);
    });

    test("needs attention: broken alerts and screening channels", () => {
      const json = toJson(
        makeInput("automod", {
          config: typicalConfig(),
          screening: SCREENING,
          health: [
            [CH.alerts, { kind: "missing_channel" }],
            [
              CH.screening,
              { kind: "missing_permissions", permissions: ["Send Messages"] },
            ],
          ],
        }),
      );
      expect(json.accent_color).toBe(Color.Warning);
      const text = allText(json);
      expect(text).toContain(
        `<:warning:1400000000000000002> **Member screening** · Reviews in <#${CH.screening}> · checks avatars\n-# sushii can't post there: needs Send Messages`,
      );
      expect(text).toContain(
        `<:warning:1400000000000000002> **Alerts channel** · <#${CH.alerts}>\n-# <#${CH.alerts}> was deleted, pick a new channel\n-# Actions are always logged`,
      );
    });

    test("a disabled mod log isn't named as where actions are logged", () => {
      const config = typicalConfig();
      config.loggingSettings.modLogEnabled = false;
      const text = allText(toJson(makeInput("automod", { config })));

      expect(text).toContain(
        "-# Actions are logged in your mod log when it's on",
      );
      expect(text).not.toContain(`<#${CH.mod}>`);
      expect(text).not.toContain("always logged");
    });

    test("a mod log needing attention isn't named as where actions are logged", () => {
      const text = allText(toJson(makeInput("automod", attentionFixture())));

      expect(text).toContain(
        "-# Actions aren't logged until your mod log is fixed",
      );
      expect(text).not.toContain(`<#${CH.staff}>`);
      expect(text).not.toContain("always logged");
    });

    test("fresh", () => {
      const json = toJson(makeInput("automod", fresh()));
      const text = allText(json);
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Scam images** · Off",
      );
      expect(text).toContain("**Exempt roles** · Not set");
      expect(text).toContain(
        "**Alerts channel** · Not set\n-# Actions are logged in your mod log when it's on",
      );
      expect(text).not.toContain("<:enabled");
      expect(
        buttons(json)
          .filter((b) => String(b.custom_id).startsWith("settings:toggle:"))
          .map((b) => b.label),
      ).toEqual(["Turn on", "Turn on"]);
    });

    test("expired", () => {
      const json = toJson(
        makeInput(
          "automod",
          { config: typicalConfig(), screening: SCREENING },
          { expired: true },
        ),
      );
      for (const b of buttons(json)) {
        expect(b.disabled).toBe(true);
      }
    });

    test("emoji-missing fallback", () => {
      const text = allText(
        toJson(makeInput("automod", fresh(), { emojis: NO_EMOJIS })),
      );
      expect(text).toContain("➖ **Scam images** · Off");
      expect(text).toContain("\n**Exempt roles** · Not set");
    });
  });

  describe("welcome", () => {
    test("typical renders the join preview once", () => {
      const text = allText(toJson(makeInput("welcome", typical())));
      expect(text).toContain(
        `<:enabled:1400000000000000001> **Channel** · <#${CH.welcome}>`,
      );
      expect(text).toContain(
        `<:enabled:1400000000000000001> **Join message**\n> Welcome <@${USER_ID}> to **ONCE Lounge**! You are member #48213 💚\n> Grab roles in the role menu and say hi!`,
      );
      expect(text.match(/Welcome </g)).toHaveLength(1);
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Leave message** · Off",
      );
    });

    test("broken shared channel is explained once, on the Channel row", () => {
      const config = typicalConfig();
      config.messageSettings.leaveMessage = "Bye <username>";
      config.messageSettings.leaveMessageEnabled = true;
      const text = allText(
        toJson(
          makeInput("welcome", {
            config,
            health: [
              [
                CH.welcome,
                { kind: "missing_permissions", permissions: ["Send Messages"] },
              ],
            ],
          }),
        ),
      );
      expect(text.match(/sushii can't post there/g)).toHaveLength(1);
      expect(text).toContain(
        `<:warning:1400000000000000002> **Channel** · <#${CH.welcome}>\n-# sushii can't post there: needs Send Messages`,
      );
      expect(text).toContain(
        "<:warning:1400000000000000002> **Join message**\n> Welcome",
      );
      expect(text).toContain(
        "<:warning:1400000000000000002> **Leave message**\n> Bye nayeon",
      );
    });

    test("needs attention: no channel picked", () => {
      const config = typicalConfig();
      config.messageSettings.messageChannel = null;
      const json = toJson(makeInput("welcome", { config }));
      expect(json.accent_color).toBe(Color.Warning);
      const text = allText(json);
      expect(text).toContain(
        "**Channel** · Not set\n-# Join and leave messages need a channel",
      );
      expect(text).toContain(
        "<:warning:1400000000000000002> **Join message**\n-# On, but no channel picked\n> Welcome",
      );
    });

    test("fresh", () => {
      const json = toJson(makeInput("welcome", fresh()));
      expect(json.accent_color).toBe(Color.Info);
      const text = allText(json);
      expect(text).toContain(
        "**Channel** · Not set\n-# Join and leave messages need a channel",
      );
      expect(text).not.toMatch(/^\S+ \*\*Channel\*\*/m);
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Join message** · Off",
      );
      expect(text).toContain(
        "<:minus_silhouette:1400000000000000003> **Leave message** · Off",
      );
    });

    test("expired", () => {
      const json = toJson(makeInput("welcome", typical(), { expired: true }));
      for (const b of buttons(json)) {
        expect(b.disabled).toBe(true);
      }
    });

    test("emoji-missing fallback", () => {
      const text = allText(
        toJson(makeInput("welcome", typical(), { emojis: NO_EMOJIS })),
      );
      expect(text).toContain(`✅ **Channel** · <#${CH.welcome}>`);
      expect(text).toContain("➖ **Leave message** · Off");
    });
  });

  describe("footer accessory", () => {
    test("wraps the footer and stays enabled when expired", () => {
      const json = toJson(
        makeInput("logging", typical(), { expired: true }),
        feedbackButton(),
      );
      const footer = children(json).at(-1) as JsonNode;
      expect(footer.type).toBe(9);
      expect(footer.accessory?.custom_id).toBe("feedback/panel/settings");
      expect(footer.accessory?.disabled).toBeUndefined();
    });

    test("plain text footer without accessory", () => {
      const json = toJson(makeInput("logging", typical()));
      expect((children(json).at(-1) as JsonNode).type).toBe(10);
    });
  });
});

describe("budgets", () => {
  const LONG = Array.from(
    { length: 40 },
    (_, i) => `Line ${i} <server> <mention> rules`,
  )
    .join("\n")
    .padEnd(1000, "x")
    .slice(0, 1000);
  const PROBLEM: AttentionProblem = {
    kind: "missing_permissions",
    permissions: ["View Channel", "Send Messages", "Embed Links"],
  };
  const attention: RowState = { kind: "attention", problem: PROBLEM };

  function maxConfig(): GuildConfig {
    const config = typicalConfig();
    config.loggingSettings.reactionLogChannel = CH.reaction;
    config.loggingSettings.reactionLogEnabled = true;
    const mod = config.moderationSettings;
    mod.timeoutDmText = LONG;
    mod.warnDmText = LONG;
    mod.banDmText = LONG;
    mod.kickDmText = LONG;
    mod.kickDmEnabled = true;
    mod.automodExemptRoleIds = Array.from(
      { length: 10 },
      (_, i) => `10293847561029385${String(i).padStart(2, "0")}`,
    );
    config.messageSettings.joinMessage = LONG;
    config.messageSettings.leaveMessage = LONG;
    config.messageSettings.leaveMessageEnabled = true;
    return config;
  }

  function maxStatus(): SettingsStatus {
    const items: AttentionItem[] = [
      ["logging", "modlog"],
      ["logging", "memberlog"],
      ["logging", "msglog"],
      ["logging", "reactionlog"],
      ["automod", "screening"],
      ["automod", "alerts"],
      ["welcome", "welcome-channel"],
      ["welcome", "join"],
      ["welcome", "leave"],
    ].map(([tab, row]) => ({ tab, row, problem: PROBLEM }) as AttentionItem);

    return {
      logging: {
        modlog: attention,
        memberlog: attention,
        msglog: attention,
        reactionlog: attention,
      },
      moderation: {
        "dm-timeout": { kind: "attention", problem: { kind: "needs_mod_log" } },
        "dm-warn": { kind: "on" },
        "dm-ban": { kind: "on" },
        "dm-kick": { kind: "on" },
        lookup: { kind: "on" },
      },
      automod: {
        scam: { kind: "on" },
        spam: { kind: "on" },
        screening: attention,
        exempt: { kind: "on" },
        alerts: attention,
      },
      welcome: {
        "welcome-channel": attention,
        join: attention,
        leave: attention,
      },
      attention: items,
      tabAttention: {
        overview: true,
        logging: true,
        moderation: true,
        automod: true,
        welcome: true,
      },
    };
  }

  for (const [tab, ignoredCount] of SETTINGS_TABS.flatMap((t) =>
    [25, 200].map((n) => [t, n] as const),
  )) {
    test(`${tab} with ${ignoredCount} ignored channels stays within 32 components and 3000 characters`, () => {
      const input: PanelInput = {
        tab,
        config: maxConfig(),
        status: maxStatus(),
        screening: SCREENING,
        ignoredChannelIds: Array.from(
          { length: ignoredCount },
          (_, i) => `1029384756102939${String(i).padStart(3, "0")}`,
        ),
        emojis: EMOJIS,
        expired: false,
        preview: {
          userId: USER_ID,
          username: "u".repeat(32),
          guildName: "S".repeat(100),
          memberCount: 1234567,
        },
      };

      const json = toJson(input, feedbackButton());
      expect(countComponents(json)).toBeLessThanOrEqual(32);
      expect(textLength(json)).toBeLessThanOrEqual(3000);
    });
  }

  for (const hostile of [
    "<server><member_number><mention>".repeat(40).slice(0, 1000),
    Array.from({ length: 200 }, () => "<server> ```")
      .join("\n")
      .slice(0, 1000),
  ]) {
    test(`welcome with no channel and a hostile ${hostile.length}-character template stays within budget`, () => {
      const config = maxConfig();
      config.messageSettings.messageChannel = null;
      config.messageSettings.joinMessage = hostile;
      config.messageSettings.leaveMessage = hostile;
      const input = makeInput(
        "welcome",
        { config },
        {
          preview: {
            userId: USER_ID,
            username: "u".repeat(32),
            guildName: "S".repeat(100),
            memberCount: 1234567,
          },
        },
      );
      expect(input.status.welcome.join).toEqual({
        kind: "attention",
        problem: { kind: "no_channel" },
      });

      const json = toJson(input, feedbackButton());
      expect(countComponents(json)).toBeLessThanOrEqual(32);
      expect(textLength(json)).toBeLessThanOrEqual(3000);
    });
  }
});

describe("message log ignored channels", () => {
  test("hidden while the message log is off", () => {
    const config = typicalConfig();
    config.loggingSettings.messageLogChannel = null;
    const text = allText(toJson(makeInput("logging", { config })));
    expect(text).not.toContain("Ignoring");
  });

  test("first 10 by snowflake order, then a count", () => {
    const ids = Array.from({ length: 12 }, (_, i) =>
      String(9000000000000000000n - BigInt(i) * 1000n),
    );
    ids.push("999999999999999999");
    const text = ignoredText(ids);
    const sorted = [...ids].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    expect(text).toBe(
      `Ignoring ${sorted
        .slice(0, 10)
        .map((id) => `<#${id}>`)
        .join(", ")}, +3 more`,
    );
    expect(text.startsWith("Ignoring <#999999999999999999>")).toBe(true);
  });

  test("empty list gives no text", () => {
    expect(ignoredText([])).toBe("");
  });

  test("no count when 10 or fewer", () => {
    expect(ignoredText([CH.memes, CH.botspam])).toBe(
      `Ignoring <#${CH.botspam}>, <#${CH.memes}>`,
    );
  });
});

describe("emoji fallbacks", () => {
  test("empty emoji strings fall back like missing ones", () => {
    const empty = Object.fromEntries(
      Object.keys(EMOJIS).map((k) => [k, ""]),
    ) as unknown as PanelEmojis;
    const json = toJson(
      makeInput("logging", attentionFixture(), { emojis: empty }),
    );
    const text = allText(json);
    expect(text).toContain(`⚠️ **Mod log** · <#${CH.staff}>`);
    expect(text).toContain("➖ **Reaction log** · Off");
    for (const b of tabButtons(json)) {
      expect(b.emoji).toBeUndefined();
    }
  });
});

describe("attentionDetail", () => {
  test("missing channel without an id", () => {
    expect(attentionDetail({ kind: "missing_channel" }, null)).toBe(
      "Channel no longer exists, pick a new one",
    );
  });
});

describe("message previews", () => {
  const ctx = (guildName: string): MessagePreviewContext => ({
    userId: USER_ID,
    username: "nayeon",
    guildName,
    memberCount: 42,
  });

  test("substitutes every placeholder", () => {
    expect(
      renderMessagePreview(
        "Hi <mention> (<username>) to <server>, #<member_number>",
        ctx("ONCE Lounge"),
      ),
    ).toBe(`Hi <@${USER_ID}> (nayeon) to ONCE Lounge, #42`);
  });

  test("dollar patterns in names stay literal", () => {
    expect(
      renderMessagePreview("Welcome to <server>!", ctx("Cash $' $$ Club")),
    ).toBe("Welcome to Cash $' $$ Club!");
  });

  test("substituted values are not scanned again", () => {
    expect(
      renderMessagePreview(
        "<server> #<member_number>",
        ctx("The <member_number> Club"),
      ),
    ).toBe("The <member_number> Club #42");
  });

  test("line limit keeps whole lines, including a stray <", () => {
    const template = [
      "I <3 this server",
      ...Array.from({ length: 10 }, (_, i) => `line ${i}`),
    ].join("\n");
    const out = quotedPreview(template, ctx("x"));
    expect(out.startsWith("> I <3 this server\n> line 0")).toBe(true);
    expect(out.endsWith("> line 6…")).toBe(true);
  });

  test("char cut keeps a stray < near the end", () => {
    const out = quotedPreview(
      `${"a".repeat(690)} <3 ${"b".repeat(20)}`,
      ctx("x"),
    );
    expect(out).toBe(`> ${"a".repeat(690)} <3 ${"b".repeat(6)}…`);
  });

  test("char cut drops a lone high surrogate", () => {
    const out = quotedPreview(`${"a".repeat(699)}😀tail`, ctx("x"));
    expect(out).toBe(`> ${"a".repeat(699)}…`);
  });

  test("truncation drops a half-cut mention", () => {
    const template = `${"a".repeat(690)} <mention> end`;
    const out = quotedPreview(template, ctx("x"));
    expect(out).toBe(`> ${"a".repeat(690)}…`);
  });

  test("truncation closes an open code fence", () => {
    const template = `intro\n\`\`\`\n${"code ".repeat(200)}\n\`\`\``;
    const out = quotedPreview(template, ctx("x"));
    expect(out.endsWith("…\n> ```")).toBe(true);
    expect(out.match(/```/g)).toHaveLength(2);
  });
});
