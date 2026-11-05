import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MessageComponentInteraction } from "discord.js";
import { ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { Err, Ok } from "ts-results";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type {
  PromptActionContext,
  PromptInteraction,
} from "../../domain/PromptDefinition";
import { configureFollowUpdatesPrompt, followUpdatesPrompt } from "./index";

const GUILD_ID = "100000000000000001";
const CHANNEL = "200000000000000001";

function setup(config: GuildConfig) {
  const follow = mock(async () =>
    Ok({ webhookId: "300000000000000001", alreadyFollowing: false }),
  );
  const save = mock(async (c: GuildConfig) => c);
  configureFollowUpdatesPrompt({
    updates: { follow },
    guildConfigRepository: {
      findByGuildId: mock(async () => config),
      save,
    },
  });
  return { follow, save };
}

function interaction(opts: {
  manageGuild?: boolean;
  botManageWebhooks?: boolean;
}): PromptInteraction {
  return {
    guildId: GUILD_ID,
    memberPermissions: {
      has: (flag: bigint) =>
        flag === PermissionFlagsBits.ManageGuild && (opts.manageGuild ?? true),
    },
    guild: {
      members: {
        me: { permissions: { has: () => opts.botManageWebhooks ?? true } },
      },
    },
  } as unknown as PromptInteraction;
}

function withChannel(): GuildConfig {
  return GuildConfig.createDefault(GUILD_ID).updateLogChannel(
    "notifications",
    CHANNEL,
  );
}

function rowTypes(
  content: Awaited<ReturnType<typeof followUpdatesPrompt.build>>,
) {
  return (content.rows ?? []).map((row) =>
    row.components.map((c) => {
      const data = c.toJSON();
      return "custom_id" in data ? data.custom_id : data.type;
    }),
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
    expect(await followUpdatesPrompt.eligible(interaction({}))).toBe(false);
  });

  test("needs Manage Server", async () => {
    setup(withChannel());
    expect(
      await followUpdatesPrompt.eligible(interaction({ manageGuild: false })),
    ).toBe(false);
  });

  test("eligible until the server follows", async () => {
    const config = withChannel();
    setup(config);
    expect(await followUpdatesPrompt.eligible(interaction({}))).toBe(true);

    config.loggingSettings.sushiiUpdatesWebhookId = "300000000000000001";
    expect(await followUpdatesPrompt.eligible(interaction({}))).toBe(false);
  });
});

describe("follow_updates content", () => {
  test("state A asks for a channel", async () => {
    setup(GuildConfig.createDefault(GUILD_ID));

    const content = await followUpdatesPrompt.build(interaction({}));

    expect(content.text).toBe(
      [
        "## 🔔 Pick a channel for sushii notifications",
        "sushii tells you there when something in your server needs fixing, like a missing permission. It also posts sushii updates about new features.",
        "-# You don't need to join the support server.",
      ].join("\n"),
    );
    expect(rowTypes(content)).toEqual([
      ["prompt:follow_updates:channel_select"],
      ["prompt:follow_updates:snooze", "prompt:follow_updates:dismiss"],
    ]);
    const select = content.rows?.[0].components[0].toJSON();
    expect(select).toMatchObject({
      type: ComponentType.ChannelSelect,
      channel_types: [0, 5],
    });
  });

  test("state A warns when sushii lacks Manage Webhooks", async () => {
    setup(GuildConfig.createDefault(GUILD_ID));

    const content = await followUpdatesPrompt.build(
      interaction({ botManageWebhooks: false }),
    );

    expect(content.text).toEndWith(
      "-# ⚠️ sushii needs **Manage Webhooks** in that channel to post updates.",
    );
  });

  test("state B offers to follow into the notifications channel", async () => {
    setup(withChannel());

    const content = await followUpdatesPrompt.build(interaction({}));

    expect(content.text).toBe(
      [
        `## 📢 Get sushii updates in <#${CHANNEL}> too?`,
        `sushii already tells you in <#${CHANNEL}> when something in your server needs fixing. It can also post sushii updates about new features there.`,
        "-# You don't need to join the support server.",
      ].join("\n"),
    );
    expect(rowTypes(content)).toEqual([
      [
        "prompt:follow_updates:follow",
        "prompt:follow_updates:snooze",
        "prompt:follow_updates:dismiss",
      ],
    ]);
  });
});

describe("follow_updates actions", () => {
  function component(values?: string[]) {
    const editReply = mock(async () => undefined);
    const reply = mock(async () => undefined);
    const i = {
      guildId: GUILD_ID,
      guild: { id: GUILD_ID },
      customId: "prompt:follow_updates:x",
      isChannelSelectMenu: () => values !== undefined,
      values,
      deferUpdate: mock(async () => undefined),
      update: mock(async () => undefined),
      reply,
      editReply,
    } as unknown as MessageComponentInteraction<"cached">;
    const ctx = {
      subject: { scope: "guild", id: BigInt(GUILD_ID) },
      recordCompleted: mock(async () => undefined),
      recordDismissed: mock(async () => undefined),
    } satisfies PromptActionContext;
    return { i, ctx, editReply, reply };
  }

  const following = () => {
    const config = withChannel();
    config.loggingSettings.sushiiUpdatesWebhookId = "300000000000000001";
    return config;
  };

  test("an old prompt clicked after following shows success without following again", async () => {
    const t = setup(following());
    const { i, ctx, editReply } = component();

    await handleAction(i, "follow", ctx);

    expect(t.follow).not.toHaveBeenCalled();
    expect(ctx.recordCompleted).toHaveBeenCalled();
    expect(JSON.stringify(editReply.mock.calls[0])).toContain(
      "Following sushii updates",
    );
  });

  test("the channel picker on a following guild just shows success", async () => {
    const t = setup(following());
    const { i, ctx, editReply } = component([CHANNEL]);

    await handleAction(i, "channel_select", ctx);

    expect(t.save).not.toHaveBeenCalled();
    expect(t.follow).not.toHaveBeenCalled();
    expect(JSON.stringify(editReply.mock.calls[0])).toContain(
      "Following sushii updates",
    );
  });

  test("a failed pick says the channel was saved and what's missing", async () => {
    const t = setup(GuildConfig.createDefault(GUILD_ID));
    t.follow.mockResolvedValueOnce(Err("channel_access") as never);
    const { i, ctx, editReply } = component([CHANNEL]);

    await handleAction(i, "channel_select", ctx);

    const sent = JSON.stringify(editReply.mock.calls[0]);
    expect(sent).toContain("is saved as your sushii notifications channel");
    expect(sent).toContain("View Channel");
    expect(ctx.recordCompleted).not.toHaveBeenCalled();
  });

  test("an old prompt after the feature is turned off gets a short reply", async () => {
    configureFollowUpdatesPrompt(null);
    const { i, ctx, reply } = component();

    await handleAction(i, "follow", ctx);

    expect(reply).toHaveBeenCalledWith({
      content: "sushii updates aren't available right now.",
      flags: MessageFlags.Ephemeral,
    });
  });

  test("an unknown action throws a fixed message", async () => {
    setup(withChannel());
    const { i, ctx } = component();

    expect(handleAction(i, "nope", ctx)).rejects.toThrow(
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

  test("picking a channel saves it, follows and completes", async () => {
    const t = setup(GuildConfig.createDefault(GUILD_ID));
    const { i, ctx, editReply } = component([CHANNEL]);

    await handleAction(i, "channel_select", ctx);

    const saved = t.save.mock.calls[0][0];
    expect(saved.loggingSettings.sushiiNotificationsChannel).toBe(CHANNEL);
    expect(saved.loggingSettings.sushiiNotificationsEnabled).toBe(true);
    expect(t.follow).toHaveBeenCalledWith(i.guild, CHANNEL, "prompt");
    expect(ctx.recordCompleted).toHaveBeenCalled();
    expect(JSON.stringify(editReply.mock.calls[0])).toContain(
      "Following sushii updates",
    );
  });

  test("a failed follow keeps the prompt open and explains why", async () => {
    const t = setup(withChannel());
    t.follow.mockResolvedValueOnce(Err("missing_permissions") as never);
    const { i, ctx, editReply } = component();

    await handleAction(i, "follow", ctx);

    expect(t.save).not.toHaveBeenCalled();
    expect(ctx.recordCompleted).not.toHaveBeenCalled();
    expect(JSON.stringify(editReply.mock.calls[0])).toContain(
      "Manage Webhooks",
    );
  });
});
