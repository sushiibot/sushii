import { describe, expect, test } from "bun:test";
import type { Guild, ModalSubmitFields } from "discord.js";
import {
  ChannelType,
  ComponentType,
  ModalSubmitFields as ModalSubmitFieldsClass,
  ModalSubmitInteraction,
} from "discord.js";

import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { SettingsPatch } from "../../application/SettingsPatch";
import type {
  RowState,
  SettingsStatus,
} from "../../application/SettingsStatus";
import { computeSettingsStatus } from "../../application/SettingsStatus";
import type { SettingsEditTarget } from "../session/settingsIds";
import { parseSettingsId } from "../session/settingsIds";
import type { ModalContext, ModalSubmission } from "./ModalContext";
import { resolveModalPrefills } from "./modalFields";
import { buildSettingsModal, parseSettingsModal } from "./settingsModals";

const GUILD_ID = "100000000000000001";
const MOD_CHANNEL = "200000000000000001";
const MEMBER_CHANNEL = "200000000000000002";
const MESSAGE_CHANNEL = "200000000000000003";
const REACTION_CHANNEL = "200000000000000004";
const WELCOME_CHANNEL = "200000000000000005";
const ALERTS_CHANNEL = "200000000000000006";
const SCREENING_CHANNEL = "200000000000000007";
const IGNORED_A = "200000000000000010";
const IGNORED_B = "200000000000000011";
const ROLE_A = "300000000000000001";
const ROLE_B = "300000000000000002";

const ON: RowState = { kind: "on" };
const OFF: RowState = { kind: "off" };
const NOT_SET: RowState = { kind: "not_set" };
const MISSING_PERMISSIONS: RowState = {
  kind: "attention",
  problem: { kind: "missing_permissions", permissions: ["SendMessages"] },
};
const MISSING_CHANNEL: RowState = {
  kind: "attention",
  problem: { kind: "missing_channel" },
};

function makeConfig(): GuildConfig {
  const config = GuildConfig.createDefault(GUILD_ID);
  return new GuildConfig(
    GUILD_ID,
    null,
    {
      ...config.messageSettings,
      joinMessage: "Welcome <mention>!",
      joinMessageEnabled: true,
      leaveMessage: null,
      leaveMessageEnabled: false,
      messageChannel: WELCOME_CHANNEL,
    },
    {
      modLogChannel: MOD_CHANNEL,
      modLogEnabled: true,
      memberLogChannel: MEMBER_CHANNEL,
      memberLogEnabled: true,
      messageLogChannel: MESSAGE_CHANNEL,
      messageLogEnabled: true,
      reactionLogChannel: REACTION_CHANNEL,
      reactionLogEnabled: false,
    },
    {
      ...config.moderationSettings,
      timeoutDmText: "Read the rules.",
      timeoutCommandDmEnabled: true,
      timeoutNativeDmEnabled: false,
      warnDmText: null,
      banDmText: "Appeal at https://example.com",
      banDmEnabled: true,
      kickDmText: null,
      kickDmEnabled: false,
      automodAlertsChannelId: ALERTS_CHANNEL,
      automodExemptRoleIds: [ROLE_A, ROLE_B],
    },
    [],
  );
}

function makeStatus(
  overrides: Partial<{
    logging: Partial<SettingsStatus["logging"]>;
    automod: Partial<SettingsStatus["automod"]>;
    welcome: Partial<SettingsStatus["welcome"]>;
  }> = {},
): SettingsStatus {
  return {
    logging: {
      modlog: ON,
      memberlog: ON,
      msglog: ON,
      reactionlog: OFF,
      ...overrides.logging,
    },
    moderation: {
      "dm-timeout": ON,
      "dm-warn": ON,
      "dm-ban": ON,
      "dm-kick": OFF,
      lookup: ON,
    },
    automod: {
      scam: ON,
      spam: ON,
      screening: ON,
      exempt: ON,
      alerts: ON,
      ...overrides.automod,
    },
    welcome: {
      "welcome-channel": ON,
      join: ON,
      leave: OFF,
      ...overrides.welcome,
    },
    attention: [],
    tabAttention: {
      overview: false,
      logging: false,
      moderation: false,
      automod: false,
      welcome: false,
    },
  };
}

const SCREENING: ScreeningSettingsState = {
  enabled: true,
  logChannelId: SCREENING_CHANNEL,
  checkAvatars: true,
};

type BaseCtx = Omit<
  ModalContext,
  "prefilledIgnoredChannelIds" | "prefilledExemptRoleIds"
>;

/** Pre-fills come from a guild cache holding every stored ID except `deleted`. */
function makeCtx(
  overrides: Partial<BaseCtx> = {},
  deleted: string[] = [],
): ModalContext {
  const base: BaseCtx = {
    config: makeConfig(),
    status: makeStatus(),
    screening: SCREENING,
    ignoredChannelIds: [IGNORED_A, IGNORED_B],
    ...overrides,
  };
  const roleIds = base.config.moderationSettings.automodExemptRoleIds;
  const existing = (ids: string[]) => ids.filter((id) => !deleted.includes(id));
  const guild = {
    channels: {
      cache: new Map(
        existing(base.ignoredChannelIds).map((id) => [
          id,
          { type: ChannelType.GuildText },
        ]),
      ),
    },
    roles: { cache: new Map(existing(roleIds).map((id) => [id, {}])) },
  } as unknown as Pick<Guild, "channels" | "roles">;

  return {
    ...base,
    ...resolveModalPrefills(guild, base.ignoredChannelIds, roleIds),
  };
}

function parse(
  target: SettingsEditTarget,
  submission: ModalSubmission,
  ctx: ModalContext = makeCtx(),
): SettingsPatch[] {
  return parseSettingsModal(target, submission, ctx);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function modalJson(target: SettingsEditTarget, ctx: ModalContext): Json {
  return buildSettingsModal(target, ctx).toJSON();
}

function labelComponent(json: Json, index: number): Json {
  const label = json.components[index];
  expect(label.type).toBe(ComponentType.Label);
  return label.component;
}

const transformComponent = (
  ModalSubmitInteraction as unknown as {
    transformComponent(raw: unknown): unknown;
  }
).transformComponent.bind(ModalSubmitInteraction);

const ModalSubmitFieldsCtor = ModalSubmitFieldsClass as unknown as new (
  components: unknown[],
) => ModalSubmitFields;

/** Builds `fields` the way discord.js does from a raw MODAL_SUBMIT payload. */
function submit(components: Record<string, unknown>[]): ModalSubmission {
  const raw = components.map((component, i) => ({
    type: ComponentType.Label,
    id: i + 1,
    component,
  }));
  return { fields: new ModalSubmitFieldsCtor(raw.map(transformComponent)) };
}

const channelSelect = (customId: string, values: string[]) => ({
  type: ComponentType.ChannelSelect,
  custom_id: customId,
  values,
});
const textInput = (value: string) => ({
  type: ComponentType.TextInput,
  custom_id: "text",
  value,
});
const checkbox = (customId: string, value: boolean) => ({
  type: ComponentType.Checkbox,
  custom_id: customId,
  value,
});

describe("buildSettingsModal", () => {
  test.each([
    "modlog",
    "memberlog",
    "msglog",
    "reactionlog",
    "dm-timeout",
    "dm-warn",
    "dm-ban",
    "dm-kick",
    "welcome-channel",
    "join",
    "leave",
    "exempt",
    "alerts",
    "screening",
  ] as const)("%s uses a fresh settings modal ID", (target) => {
    const ctx = makeCtx();
    const first = modalJson(target, ctx).custom_id;
    const second = modalJson(target, ctx).custom_id;

    expect(parseSettingsId(first)).toEqual({
      kind: "modal",
      target,
      nonce: expect.stringMatching(/^[0-9a-z]{8}$/),
    });
    expect(first).not.toBe(second);
  });

  describe("logs", () => {
    test("modlog on pre-fills the channel", () => {
      const json = modalJson("modlog", makeCtx());

      expect(json.title).toBe("Mod log");
      expect(json.components).toEqual([
        {
          type: ComponentType.Label,
          label: "Channel",
          description:
            "Where bans, kicks, timeouts and warnings are logged. Clear it to turn off.",
          component: {
            type: ComponentType.ChannelSelect,
            custom_id: "channel",
            channel_types: [0, 5],
            min_values: 0,
            max_values: 1,
            required: false,
            default_values: [{ id: MOD_CHANNEL, type: "channel" }],
          },
        },
      ]);
    });

    test("an off log leaves the channel empty even when one is stored", () => {
      const json = modalJson("reactionlog", makeCtx());
      const select = labelComponent(json, 0);

      expect(json.components[0].description).toBe(
        "Where removed reactions are logged. Pick one to turn on.",
      );
      expect(select.default_values).toBeUndefined();
      expect(select.min_values).toBe(0);
      expect(select.required).toBe(false);
    });

    test("an attention log pre-fills the broken channel", () => {
      const ctx = makeCtx({
        status: makeStatus({ logging: { memberlog: MISSING_PERMISSIONS } }),
      });
      const select = labelComponent(modalJson("memberlog", ctx), 0);

      expect(select.default_values).toEqual([
        { id: MEMBER_CHANNEL, type: "channel" },
      ]);
    });

    test("msglog adds the ignored channels select with current values", () => {
      const json = modalJson(
        "msglog",
        makeCtx({ status: makeStatus({ logging: { msglog: OFF } }) }),
      );

      expect(json.components).toHaveLength(2);
      expect(labelComponent(json, 0).default_values).toBeUndefined();
      expect(json.components[1].label).toBe("Ignored channels");
      expect(json.components[1].description).toBe("Busy channels to skip");
      expect(labelComponent(json, 1)).toEqual({
        type: ComponentType.ChannelSelect,
        custom_id: "ignored",
        channel_types: [0, 5],
        min_values: 0,
        max_values: 25,
        required: false,
        default_values: [
          { id: IGNORED_A, type: "channel" },
          { id: IGNORED_B, type: "channel" },
        ],
      });
    });

    test("msglog with no ignored channels has no defaults", () => {
      const json = modalJson("msglog", makeCtx({ ignoredChannelIds: [] }));

      expect(labelComponent(json, 1).default_values).toBeUndefined();
    });
  });

  describe("DMs", () => {
    test("dm-timeout pre-fills sources and text", () => {
      const json = modalJson("dm-timeout", makeCtx());

      expect(json.title).toBe("Timeout DM");
      expect(json.components[0].label).toBe("Send a DM when timing out with");
      expect(labelComponent(json, 0)).toEqual({
        type: ComponentType.CheckboxGroup,
        custom_id: "sources",
        min_values: 0,
        max_values: 2,
        required: false,
        options: [
          { value: "command", label: "/timeout", default: true },
          { value: "native", label: "Right-click → Timeout", default: false },
        ],
      });
      expect(json.components[1].label).toBe("Extra text");
      expect(json.components[1].description).toBe(
        "Added below the reason. Leave empty for none.",
      );
      expect(labelComponent(json, 1)).toEqual({
        type: ComponentType.TextInput,
        custom_id: "text",
        style: 2,
        max_length: 1000,
        required: false,
        value: "Read the rules.",
      });
    });

    test("dm-warn is a note plus extra text with no value when unset", () => {
      const json = modalJson("dm-warn", makeCtx());

      expect(json.components[0]).toEqual({
        type: ComponentType.TextDisplay,
        content: "Warn DMs are always sent.",
      });
      expect(json.components).toHaveLength(2);
      expect(labelComponent(json, 1).value).toBeUndefined();
      expect(labelComponent(json, 1).required).toBe(false);
    });

    test("dm-ban pre-fills the checkbox and text", () => {
      const json = modalJson("dm-ban", makeCtx());

      expect(json.components[0]).toEqual({
        type: ComponentType.Label,
        label: "Send a DM when banning with /ban",
        description: "Right-click bans can't send DMs",
        component: {
          type: ComponentType.Checkbox,
          custom_id: "enabled",
          default: true,
        },
      });
      expect(labelComponent(json, 1).value).toBe(
        "Appeal at https://example.com",
      );
    });

    test("dm-kick pre-fills an unchecked checkbox", () => {
      const json = modalJson("dm-kick", makeCtx());

      expect(json.components[0].label).toBe(
        "Send a DM when kicking with /kick",
      );
      expect(json.components[0].description).toBe(
        "Right-click kicks can't send DMs",
      );
      expect(labelComponent(json, 0).default).toBe(false);
    });
  });

  describe("welcome", () => {
    test("welcome-channel set pre-fills the channel", () => {
      const json = modalJson("welcome-channel", makeCtx());

      expect(json.components[0].description).toBe(
        "Where join and leave messages are sent. Join and leave messages need a channel to send.",
      );
      expect(labelComponent(json, 0)).toMatchObject({
        type: ComponentType.ChannelSelect,
        min_values: 0,
        required: false,
        default_values: [{ id: WELCOME_CHANNEL, type: "channel" }],
      });
    });

    test("welcome-channel not set has no defaults", () => {
      const ctx = makeCtx({
        status: makeStatus({ welcome: { "welcome-channel": NOT_SET } }),
      });

      expect(
        labelComponent(modalJson("welcome-channel", ctx), 0).default_values,
      ).toBeUndefined();
    });

    test("join pre-fills the checkbox and message", () => {
      const json = modalJson("join", makeCtx());

      expect(json.title).toBe("Join message");
      expect(json.components[0].label).toBe(
        "Send a message when someone joins",
      );
      expect(labelComponent(json, 0)).toEqual({
        type: ComponentType.Checkbox,
        custom_id: "enabled",
        default: true,
      });
      expect(json.components[1].label).toBe("Message");
      expect(json.components[1].description).toBe(
        "Placeholders: <mention> <username> <server> <member_number>",
      );
      expect(labelComponent(json, 1)).toMatchObject({
        max_length: 1000,
        required: false,
        value: "Welcome <mention>!",
      });
    });

    test("a default guild's join checkbox is unchecked", () => {
      const config = GuildConfig.createDefault(GUILD_ID);
      const ctx = makeCtx({
        config,
        status: computeSettingsStatus({
          config,
          screening: null,
          channelHealth: new Map(),
        }),
      });

      expect(config.messageSettings.joinMessageEnabled).toBe(true);
      expect(labelComponent(modalJson("join", ctx), 0).default).toBe(false);
    });

    test("leave pre-fills an unchecked checkbox and no message", () => {
      const json = modalJson("leave", makeCtx());

      expect(json.title).toBe("Leave message");
      expect(json.components[0].label).toBe(
        "Send a message when someone leaves",
      );
      expect(labelComponent(json, 0).default).toBe(false);
      expect(labelComponent(json, 1).value).toBeUndefined();
    });
  });

  describe("automod", () => {
    test("exempt pre-fills current roles", () => {
      const json = modalJson("exempt", makeCtx());

      expect(labelComponent(json, 0)).toEqual({
        type: ComponentType.RoleSelect,
        custom_id: "roles",
        min_values: 0,
        max_values: 10,
        required: false,
        default_values: [
          { id: ROLE_A, type: "role" },
          { id: ROLE_B, type: "role" },
        ],
      });
    });

    test("exempt doesn't pre-fill deleted roles", () => {
      const json = modalJson("exempt", makeCtx({}, [ROLE_B]));

      expect(labelComponent(json, 0).default_values).toEqual([
        { id: ROLE_A, type: "role" },
      ]);
    });

    test("exempt with every role deleted has no defaults", () => {
      const json = modalJson("exempt", makeCtx({}, [ROLE_A, ROLE_B]));

      expect(labelComponent(json, 0).default_values).toBeUndefined();
    });

    test("alerts on pre-fills, not set does not", () => {
      const on = labelComponent(modalJson("alerts", makeCtx()), 0);
      const notSet = labelComponent(
        modalJson(
          "alerts",
          makeCtx({ status: makeStatus({ automod: { alerts: NOT_SET } }) }),
        ),
        0,
      );

      expect(on).toMatchObject({
        min_values: 0,
        required: false,
        default_values: [{ id: ALERTS_CHANNEL, type: "channel" }],
      });
      expect(notSet.default_values).toBeUndefined();
    });

    test("screening on pre-fills the review channel and avatars", () => {
      const json = modalJson("screening", makeCtx());

      expect(json.components[0].label).toBe("Review channel");
      expect(json.components[0].description).toBe(
        "Where new members are posted for review. Clear it to turn off.",
      );
      expect(labelComponent(json, 0).default_values).toEqual([
        { id: SCREENING_CHANNEL, type: "channel" },
      ]);
      expect(json.components[1].label).toBe("Check profile pictures");
      expect(labelComponent(json, 1)).toEqual({
        type: ComponentType.Checkbox,
        custom_id: "avatars",
        default: true,
      });
    });

    test("screening off leaves the review channel empty", () => {
      const json = modalJson(
        "screening",
        makeCtx({ status: makeStatus({ automod: { screening: OFF } }) }),
      );

      expect(labelComponent(json, 0).default_values).toBeUndefined();
      expect(json.components[0].description).toBe(
        "Where new members are posted for review. Pick one to turn on.",
      );
    });

    test("screening without screening settings throws", () => {
      expect(() =>
        buildSettingsModal("screening", makeCtx({ screening: null })),
      ).toThrow();
    });
  });
});

describe("channel pre-fill with a broken channel", () => {
  test.each([
    ["modlog", { logging: { modlog: MISSING_CHANNEL } }],
    ["welcome-channel", { welcome: { "welcome-channel": MISSING_CHANNEL } }],
    ["alerts", { automod: { alerts: MISSING_CHANNEL } }],
    ["screening", { automod: { screening: MISSING_CHANNEL } }],
  ] as const)("%s with a missing channel has no default", (target, status) => {
    const json = modalJson(target, makeCtx({ status: makeStatus(status) }));

    expect(labelComponent(json, 0).default_values).toBeUndefined();
  });

  test("a log with a missing channel asks for a new one", () => {
    const json = modalJson(
      "modlog",
      makeCtx({ status: makeStatus({ logging: { modlog: MISSING_CHANNEL } }) }),
    );

    expect(json.components[0].description).toBe(
      "Where bans, kicks, timeouts and warnings are logged. Its channel is gone, pick a new one.",
    );
  });

  test.each([
    [
      "welcome-channel",
      { welcome: { "welcome-channel": MISSING_CHANNEL } },
      "Where join and leave messages are sent. Its channel is gone, pick a new one.",
    ],
    [
      "alerts",
      { automod: { alerts: MISSING_CHANNEL } },
      "Where automod alerts are posted. Its channel is gone, pick a new one.",
    ],
  ] as const)(
    "%s with a missing channel asks for a new one",
    (target, status, description) => {
      const json = modalJson(target, makeCtx({ status: makeStatus(status) }));

      expect(json.components[0].description).toBe(description);
    },
  );

  test("timeout needing the mod log does not pre-fill the mod log", () => {
    const json = modalJson(
      "modlog",
      makeCtx({
        status: makeStatus({
          logging: {
            modlog: { kind: "attention", problem: { kind: "needs_mod_log" } },
          },
        }),
      }),
    );

    expect(labelComponent(json, 0).default_values).toBeUndefined();
  });
});

describe("msglog with more than 25 ignored channels", () => {
  const many = Array.from({ length: 28 }, (_, i) =>
    String(400000000000000000n + BigInt(i)),
  );
  const ctx = () => makeCtx({ ignoredChannelIds: many });

  test("pre-fills the first 25 and says the rest are kept", () => {
    const json = modalJson("msglog", ctx());

    expect(
      labelComponent(json, 1).default_values.map((v: { id: string }) => v.id),
    ).toEqual(many.slice(0, 25));
    expect(json.components[1].description).toBe(
      "Busy channels to skip. +3 more not shown; they're kept.",
    );
  });

  test("an untouched submit keeps all ignored channels", () => {
    const patches = parse(
      "msglog",
      untouched(modalJson("msglog", ctx())),
      ctx(),
    );

    expect(patches[1]).toEqual({ kind: "messageLogIgnored", channelIds: many });
  });

  test("removing shown channels keeps the hidden ones", () => {
    const patches = parse(
      "msglog",
      submit([
        channelSelect("channel", [MESSAGE_CHANNEL]),
        channelSelect("ignored", [many[0]]),
      ]),
      ctx(),
    );

    expect(patches[1]).toEqual({
      kind: "messageLogIgnored",
      channelIds: [many[0], ...many.slice(25)],
    });
  });

  test("the hidden split doesn't depend on stored order", () => {
    const shuffled = [...many.slice(20), ...many.slice(0, 20)].reverse();
    const json = modalJson("msglog", makeCtx({ ignoredChannelIds: shuffled }));
    const shown: string[] = labelComponent(json, 1).default_values.map(
      (v: { id: string }) => v.id,
    );
    const removed = many[3];

    const patches = parse(
      "msglog",
      submit([
        channelSelect("channel", [MESSAGE_CHANNEL]),
        channelSelect(
          "ignored",
          shown.filter((id) => id !== removed),
        ),
      ]),
      makeCtx({ ignoredChannelIds: [...many].reverse() }),
    );

    expect(shown).toEqual(many.slice(0, 25));
    expect(patches[1]).toEqual({
      kind: "messageLogIgnored",
      channelIds: many.filter((id) => id !== removed),
    });
  });
});

describe("msglog with a deleted ignored channel", () => {
  const ctx = () => makeCtx({}, [IGNORED_B]);

  test("pre-fills only channels that still exist", () => {
    const json = modalJson("msglog", ctx());

    expect(labelComponent(json, 1).default_values).toEqual([
      { id: IGNORED_A, type: "channel" },
    ]);
    expect(json.components[1].description).toBe(
      "Busy channels to skip. +1 more not shown; they're kept.",
    );
  });

  test("a submit keeps the deleted channel", () => {
    const patches = parse(
      "msglog",
      submit([
        channelSelect("channel", [MESSAGE_CHANNEL]),
        channelSelect("ignored", []),
      ]),
      ctx(),
    );

    expect(patches[1]).toEqual({
      kind: "messageLogIgnored",
      channelIds: [IGNORED_B],
    });
  });

  test("a channel of the wrong type isn't pre-filled", () => {
    const prefills = resolveModalPrefills(
      {
        channels: {
          cache: new Map([[IGNORED_A, { type: ChannelType.GuildVoice }]]),
        },
        roles: { cache: new Map() },
      } as unknown as Pick<Guild, "channels" | "roles">,
      [IGNORED_A],
      [],
    );

    expect(prefills.prefilledIgnoredChannelIds).toEqual([]);
  });
});

function withJoinMessage(text: string): ModalContext {
  const config = makeConfig();
  return makeCtx({
    config: new GuildConfig(
      config.guildId,
      config.prefix,
      { ...config.messageSettings, joinMessage: text },
      config.loggingSettings,
      config.moderationSettings,
      config.disabledChannels,
    ),
  });
}

describe("long stored text", () => {
  test("text over 4000 characters pre-fills the first 4000 and says so", () => {
    const json = modalJson("join", withJoinMessage("a".repeat(4500)));

    expect(labelComponent(json, 1)).toMatchObject({
      max_length: 4000,
      value: "a".repeat(4000),
    });
    expect(json.components[1].description).toBe(
      "Placeholders: <mention> <username> <server> <member_number> Shortened to 4000 characters.",
    );
    expect(json.components[1].description.length).toBeLessThanOrEqual(100);
  });

  test("text over 1000 characters pre-fills with a raised limit", () => {
    const longText = "a".repeat(1500);
    const config = makeConfig();
    const ctx = makeCtx({
      config: new GuildConfig(
        config.guildId,
        config.prefix,
        { ...config.messageSettings, joinMessage: longText },
        config.loggingSettings,
        config.moderationSettings,
        config.disabledChannels,
      ),
    });

    expect(labelComponent(modalJson("join", ctx), 1)).toMatchObject({
      max_length: 1500,
      value: longText,
    });
  });
});

describe("parseSettingsModal", () => {
  test.each([
    ["modlog", "mod"],
    ["memberlog", "member"],
    ["reactionlog", "reaction"],
  ] as const)("%s maps the channel to a %s logChannel patch", (target, log) => {
    expect(
      parse(target, submit([channelSelect("channel", [MOD_CHANNEL])])),
    ).toEqual([{ kind: "logChannel", log, channelId: MOD_CHANNEL }]);
  });

  test("a select with no values array counts as cleared", () => {
    expect(
      parse(
        "alerts",
        submit([{ type: ComponentType.ChannelSelect, custom_id: "channel" }]),
      ),
    ).toEqual([{ kind: "automodAlertsChannel", channelId: null }]);
    expect(
      parse(
        "exempt",
        submit([{ type: ComponentType.RoleSelect, custom_id: "roles" }]),
      ),
    ).toEqual([{ kind: "automodExemptRoles", roleIds: [] }]);
  });

  test("a field of the wrong type throws", () => {
    expect(() => parse("alerts", submit([checkbox("channel", true)]))).toThrow(
      "Unexpected modal field type",
    );
  });

  test("a cleared log channel becomes null", () => {
    expect(parse("modlog", submit([channelSelect("channel", [])]))).toEqual([
      { kind: "logChannel", log: "mod", channelId: null },
    ]);
  });

  test("msglog returns the log channel and the full ignored set", () => {
    expect(
      parse(
        "msglog",
        submit([
          channelSelect("channel", [MESSAGE_CHANNEL]),
          channelSelect("ignored", [IGNORED_A, IGNORED_B]),
        ]),
      ),
    ).toEqual([
      { kind: "logChannel", log: "message", channelId: MESSAGE_CHANNEL },
      { kind: "messageLogIgnored", channelIds: [IGNORED_A, IGNORED_B] },
    ]);
  });

  test("msglog with cleared selects returns null and an empty set", () => {
    expect(
      parse(
        "msglog",
        submit([channelSelect("channel", []), channelSelect("ignored", [])]),
      ),
    ).toEqual([
      { kind: "logChannel", log: "message", channelId: null },
      { kind: "messageLogIgnored", channelIds: [] },
    ]);
  });

  test.each([
    [[], false, false],
    [["command"], true, false],
    [["native"], false, true],
    [["command", "native"], true, true],
  ])("dm-timeout sources %p", (values, commandEnabled, nativeEnabled) => {
    expect(
      parse(
        "dm-timeout",
        submit([
          {
            type: ComponentType.CheckboxGroup,
            custom_id: "sources",
            values,
          },
          textInput("  Be nice.  "),
        ]),
      ),
    ).toEqual([
      { kind: "timeoutDm", commandEnabled, nativeEnabled, text: "Be nice." },
    ]);
  });

  test("dm-warn whitespace text becomes null", () => {
    expect(parse("dm-warn", submit([textInput("   \n ")]))).toEqual([
      { kind: "warnDm", text: null },
    ]);
  });

  test("dm-ban reads the checkbox and empty text", () => {
    expect(
      parse("dm-ban", submit([checkbox("enabled", true), textInput("")])),
    ).toEqual([{ kind: "banDm", enabled: true, text: null }]);
  });

  test("dm-kick reads the checkbox and text", () => {
    expect(
      parse("dm-kick", submit([checkbox("enabled", false), textInput("Bye")])),
    ).toEqual([{ kind: "kickDm", enabled: false, text: "Bye" }]);
  });

  test("welcome-channel cleared becomes null", () => {
    expect(
      parse("welcome-channel", submit([channelSelect("channel", [])])),
    ).toEqual([{ kind: "welcomeChannel", channelId: null }]);
  });

  test("join reads the checkbox and trimmed message", () => {
    expect(
      parse(
        "join",
        submit([checkbox("enabled", true), textInput(" Hi <mention> ")]),
      ),
    ).toEqual([{ kind: "joinMessage", enabled: true, text: "Hi <mention>" }]);
  });

  test("leave with empty message becomes null text", () => {
    expect(
      parse("leave", submit([checkbox("enabled", false), textInput("")])),
    ).toEqual([{ kind: "leaveMessage", enabled: false, text: null }]);
  });

  test("exempt reads roles and a cleared select becomes empty", () => {
    const roleSelect = (values: string[]) => ({
      type: ComponentType.RoleSelect,
      custom_id: "roles",
      values,
    });

    expect(parse("exempt", submit([roleSelect([ROLE_A, ROLE_B])]))).toEqual([
      { kind: "automodExemptRoles", roleIds: [ROLE_A, ROLE_B] },
    ]);
    expect(parse("exempt", submit([roleSelect([])]))).toEqual([
      { kind: "automodExemptRoles", roleIds: [] },
    ]);
  });

  test("alerts cleared becomes null", () => {
    expect(parse("alerts", submit([channelSelect("channel", [])]))).toEqual([
      { kind: "automodAlertsChannel", channelId: null },
    ]);
  });

  test("screening reads the channel and avatars", () => {
    expect(
      parse(
        "screening",
        submit([
          channelSelect("channel", [SCREENING_CHANNEL]),
          checkbox("avatars", false),
        ]),
      ),
    ).toEqual([
      { kind: "screening", channelId: SCREENING_CHANNEL, checkAvatars: false },
    ]);
  });

  test("screening cleared becomes null", () => {
    expect(
      parse(
        "screening",
        submit([channelSelect("channel", []), checkbox("avatars", true)]),
      ),
    ).toEqual([{ kind: "screening", channelId: null, checkAvatars: true }]);
  });
});

/** The raw submission Discord sends when every field is left as pre-filled. */
function untouched(json: Json): ModalSubmission {
  const fields = json.components
    .filter((c: Json) => c.type === ComponentType.Label)
    .map(({ component: c }: Json) => {
      switch (c.type) {
        case ComponentType.ChannelSelect:
        case ComponentType.RoleSelect:
          return {
            type: c.type,
            custom_id: c.custom_id,
            values: (c.default_values ?? []).map((v: { id: string }) => v.id),
          };
        case ComponentType.TextInput:
          return { type: c.type, custom_id: c.custom_id, value: c.value ?? "" };
        case ComponentType.Checkbox:
          return {
            type: c.type,
            custom_id: c.custom_id,
            value: c.default ?? false,
          };
        case ComponentType.CheckboxGroup:
          return {
            type: c.type,
            custom_id: c.custom_id,
            values: c.options
              .filter((o: Json) => o.default)
              .map((o: Json) => o.value),
          };
        default:
          throw new Error(`Unhandled component type ${c.type}`);
      }
    });
  return submit(fields);
}

describe("untouched submit keeps the current settings", () => {
  test.each<[SettingsEditTarget, SettingsPatch[]]>([
    ["modlog", [{ kind: "logChannel", log: "mod", channelId: MOD_CHANNEL }]],
    [
      "memberlog",
      [{ kind: "logChannel", log: "member", channelId: MEMBER_CHANNEL }],
    ],
    [
      "msglog",
      [
        { kind: "logChannel", log: "message", channelId: MESSAGE_CHANNEL },
        { kind: "messageLogIgnored", channelIds: [IGNORED_A, IGNORED_B] },
      ],
    ],
    // Stored channel but the row is off: stays off.
    ["reactionlog", [{ kind: "logChannel", log: "reaction", channelId: null }]],
    [
      "dm-timeout",
      [
        {
          kind: "timeoutDm",
          commandEnabled: true,
          nativeEnabled: false,
          text: "Read the rules.",
        },
      ],
    ],
    ["dm-warn", [{ kind: "warnDm", text: null }]],
    [
      "dm-ban",
      [
        {
          kind: "banDm",
          enabled: true,
          text: "Appeal at https://example.com",
        },
      ],
    ],
    ["dm-kick", [{ kind: "kickDm", enabled: false, text: null }]],
    [
      "welcome-channel",
      [{ kind: "welcomeChannel", channelId: WELCOME_CHANNEL }],
    ],
    [
      "join",
      [{ kind: "joinMessage", enabled: true, text: "Welcome <mention>!" }],
    ],
    ["leave", [{ kind: "leaveMessage", enabled: false, text: null }]],
    ["exempt", [{ kind: "automodExemptRoles", roleIds: [ROLE_A, ROLE_B] }]],
    ["alerts", [{ kind: "automodAlertsChannel", channelId: ALERTS_CHANNEL }]],
    [
      "screening",
      [
        {
          kind: "screening",
          channelId: SCREENING_CHANNEL,
          checkAvatars: true,
        },
      ],
    ],
  ])("%s", (target, expected) => {
    const json = modalJson(target, makeCtx());

    expect(parse(target, untouched(json))).toEqual(expected);
  });
});
