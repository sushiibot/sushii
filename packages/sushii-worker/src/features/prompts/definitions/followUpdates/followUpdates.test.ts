import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MessageComponentInteraction } from "discord.js";
import { ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type {
  PromptActionContext,
  PromptInteraction,
} from "../../domain/PromptDefinition";
import { configureFollowUpdatesPrompt, followUpdatesPrompt } from "./index";

const GUILD_ID = "100000000000000001";
const CHANNEL = "200000000000000001";

function setup(config: GuildConfig) {
  const save = mock(async (c: GuildConfig) => c);
  configureFollowUpdatesPrompt({
    guildConfigRepository: {
      findByGuildId: mock(async () => config),
      save,
    },
  });
  return { save };
}

function interaction(manageGuild = true): PromptInteraction {
  return {
    guildId: GUILD_ID,
    memberPermissions: {
      has: (flag: bigint) =>
        flag === PermissionFlagsBits.ManageGuild && manageGuild,
    },
  } as unknown as PromptInteraction;
}

function withChannel(): GuildConfig {
  return GuildConfig.createDefault(GUILD_ID).updateLogChannel(
    "notifications",
    CHANNEL,
  );
}

function handleAction(
  ...args: Parameters<NonNullable<typeof followUpdatesPrompt.handleAction>>
): Promise<void> {
  if (!followUpdatesPrompt.handleAction) {
    throw new Error("follow_updates has no action handler");
  }
  return followUpdatesPrompt.handleAction(...args);
}

afterEach(() => {
  configureFollowUpdatesPrompt(null);
});

describe("follow_updates eligibility", () => {
  test("never eligible while the feature is off", async () => {
    expect(await followUpdatesPrompt.eligible(interaction())).toBe(false);
  });

  test("needs Manage Server", async () => {
    setup(GuildConfig.createDefault(GUILD_ID));
    expect(await followUpdatesPrompt.eligible(interaction(false))).toBe(false);
  });

  test("eligible only without an enabled notifications channel", async () => {
    setup(GuildConfig.createDefault(GUILD_ID));
    expect(await followUpdatesPrompt.eligible(interaction())).toBe(true);

    setup(withChannel().setLoggingEnabled("notifications", false));
    expect(await followUpdatesPrompt.eligible(interaction())).toBe(true);

    setup(withChannel());
    expect(await followUpdatesPrompt.eligible(interaction())).toBe(false);
  });
});

describe("follow_updates content", () => {
  test("asks for a channel", async () => {
    setup(GuildConfig.createDefault(GUILD_ID));

    const content = await followUpdatesPrompt.build(interaction());

    expect(content.text).toBe(
      [
        "## 🔔 Pick a channel for sushii notifications",
        "sushii tells you there when something in your server needs fixing, like a missing permission. It also posts sushii updates about new features.",
        "-# You don't need to join the support server.",
      ].join("\n"),
    );
    expect(content.text).not.toContain("Webhooks");
    const rows = (content.rows ?? []).map((row) =>
      row.components.map((c) => {
        const data = c.toJSON();
        return "custom_id" in data ? data.custom_id : data.type;
      }),
    );
    expect(rows).toEqual([
      ["prompt:follow_updates:channel_select"],
      ["prompt:follow_updates:snooze", "prompt:follow_updates:dismiss"],
    ]);
    expect(content.rows?.[0].components[0].toJSON()).toMatchObject({
      type: ComponentType.ChannelSelect,
      channel_types: [0, 5],
    });
  });
});

describe("follow_updates actions", () => {
  function component(opts: { values?: string[]; canSend?: boolean } = {}) {
    const channel = {
      isSendable: () => true,
      permissionsFor: () => ({ has: () => opts.canSend ?? true }),
    };
    const i = {
      guildId: GUILD_ID,
      guild: {
        id: GUILD_ID,
        members: { me: {} },
        channels: { cache: new Map([[CHANNEL, channel]]) },
      },
      customId: "prompt:follow_updates:channel_select",
      isChannelSelectMenu: () => opts.values !== undefined,
      values: opts.values,
      update: mock(async () => undefined),
      reply: mock(async () => undefined),
    };
    const ctx = {
      subject: { scope: "guild", id: BigInt(GUILD_ID) },
      recordCompleted: mock(async () => undefined),
      recordDismissed: mock(async () => undefined),
    } satisfies PromptActionContext;
    return {
      i: i as unknown as MessageComponentInteraction<"cached">,
      ctx,
      update: i.update,
      reply: i.reply,
    };
  }

  test("picking a channel keeps a server's sushii updates opt-out", async () => {
    const t = setup(
      GuildConfig.createDefault(GUILD_ID).setSushiiUpdatesEnabled(false),
    );
    const { i, ctx, update } = component({ values: [CHANNEL] });

    await handleAction(i, "channel_select", ctx);

    const saved = t.save.mock.calls[0][0];
    expect(saved.loggingSettings.sushiiNotificationsChannel).toBe(CHANNEL);
    expect(saved.loggingSettings.sushiiUpdatesEnabled).toBe(false);
    const sent = JSON.stringify(update.mock.calls[0]);
    expect(sent).toContain(
      `sushii will post in <#${CHANNEL}> when something needs fixing.`,
    );
    expect(sent).not.toContain("sushii updates");
  });

  test("picking a channel turns on notifications", async () => {
    const t = setup(GuildConfig.createDefault(GUILD_ID));
    const { i, ctx, update } = component({ values: [CHANNEL] });

    await handleAction(i, "channel_select", ctx);

    const saved = t.save.mock.calls[0][0];
    expect(saved.loggingSettings.sushiiNotificationsChannel).toBe(CHANNEL);
    expect(saved.loggingSettings.sushiiNotificationsEnabled).toBe(true);
    expect(saved.loggingSettings.sushiiUpdatesEnabled).toBe(true);
    expect(ctx.recordCompleted).toHaveBeenCalled();
    const sent = JSON.stringify(update.mock.calls[0]);
    expect(sent).toContain("## ✅ sushii notifications are on");
    expect(sent).toContain(
      `sushii will post in <#${CHANNEL}> when something needs fixing, plus sushii updates.`,
    );
    expect(sent).toContain(
      "-# Change this in /settings → Logging → sushii notifications.",
    );
  });

  test("a channel sushii can't post in is not saved", async () => {
    const t = setup(GuildConfig.createDefault(GUILD_ID));
    const { i, ctx, reply, update } = component({
      values: [CHANNEL],
      canSend: false,
    });

    await handleAction(i, "channel_select", ctx);

    expect(t.save).not.toHaveBeenCalled();
    expect(ctx.recordCompleted).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Send Messages"),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  test("an old prompt after the feature is turned off gets a short reply", async () => {
    const { i, ctx, reply } = component({ values: [CHANNEL] });

    await handleAction(i, "channel_select", ctx);

    expect(reply).toHaveBeenCalledWith({
      content: "sushii updates aren't available right now.",
      flags: MessageFlags.Ephemeral,
    });
  });

  test("an unknown action throws a fixed message", async () => {
    setup(withChannel());
    const { i, ctx } = component();

    expect(handleAction(i, "follow", ctx)).rejects.toThrow(
      "Unknown follow_updates action",
    );
  });

  test("only members with Manage Server can act", () => {
    const canAct = followUpdatesPrompt.canAct;
    if (!canAct) {
      throw new Error("follow_updates has no canAct");
    }
    const member = (manageGuild: boolean) =>
      ({
        memberPermissions: { has: () => manageGuild },
      }) as unknown as MessageComponentInteraction<"cached">;

    expect(canAct(member(true))).toBe(true);
    expect(canAct(member(false))).toBe(false);
  });
});
