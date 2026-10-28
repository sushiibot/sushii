import { describe, expect, mock, test } from "bun:test";
import type { Client, Message } from "discord.js";
import { MessageFlags, Routes } from "discord.js";
import pino from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ModerationCase } from "../domain/entities/ModerationCase";
import { ActionType } from "../domain/value-objects/ActionType";
import type { ModLogMessage } from "../presentation/views/ModLogMessageView";
import { MOD_LOG_FACTS_ID } from "../presentation/views/ModLogMessageView";
import { ModLogMessageService } from "./ModLogMessageService";

const GUILD = "187450744427773963";
const TARGET = "912345678901234567";
const EXECUTOR = "150443906511667200";
const LOG_CHANNEL = "1029384756102938400";
const LOG_MESSAGE = "1029384756102938499";
const DM = {
  channelId: "1029384756102938401",
  messageId: "1029384756102938402",
};

function makeCase(
  options: {
    msgId?: string | null;
    pending?: boolean;
    actionType?: ActionType;
    timeoutDuration?: number | null;
    userTag?: string;
  } = {},
): ModerationCase {
  return new ModerationCase(
    GUILD,
    "4822",
    options.actionType ?? ActionType.Ban,
    new Date("2026-10-27T11:00:00.000Z"),
    TARGET,
    options.userTag ?? "spambot",
    EXECUTOR,
    null,
    options.msgId === undefined ? LOG_MESSAGE : options.msgId,
    [],
    DM,
    options.pending ?? false,
    options.timeoutDuration ?? null,
  );
}

function flagField(bits: number) {
  return {
    bitfield: bits,
    has: (flag: number) => (bits & flag) === flag,
  };
}

function legacyMessage(
  fields: { name: string; value: string }[],
  buttonLabel = "Reason DM sent",
  suppressed = false,
) {
  const embeds = [{ fields }];
  const components = [
    {
      toJSON: () => ({
        type: 1,
        components: [{ type: 2, label: buttonLabel }],
      }),
    },
  ];
  return {
    id: LOG_MESSAGE,
    channelId: LOG_CHANNEL,
    flags: flagField(suppressed ? MessageFlags.SuppressEmbeds : 0),
    embeds,
    components,
    toJSON: () => ({ embeds, components: components.map((c) => c.toJSON()) }),
    edit: mock(async () => undefined),
  };
}

function v2Message(facts: string | null) {
  const container = {
    type: 17,
    components: facts
      ? [{ type: 10, id: MOD_LOG_FACTS_ID, content: facts }]
      : [],
  };
  return {
    id: LOG_MESSAGE,
    channelId: LOG_CHANNEL,
    flags: flagField(MessageFlags.IsComponentsV2),
    embeds: [],
    components: [{ toJSON: () => container }],
    toJSON: () => ({ embeds: [], components: [container] }),
    edit: mock(async () => undefined),
  };
}

function setup(
  options: {
    modLogChannel?: string | null;
    posted?: unknown;
    fetchError?: Error;
    userFetch?: ReturnType<typeof mock>;
  } = {},
) {
  const patch = mock(async () => undefined);
  const markDmDeleted = mock(async () => undefined);
  const users = new Map([
    [
      EXECUTOR,
      { id: EXECUTOR, tag: "tzuyu", displayAvatarURL: () => "https://x/e.png" },
    ],
  ]);
  const client = {
    user: { id: "1" },
    rest: { patch },
    users: {
      cache: users,
      fetch:
        options.userFetch ??
        mock(async () => ({
          id: TARGET,
          tag: "renamed_now",
          displayAvatarURL: () => "https://cdn.discordapp.com/avatars/x.png",
        })),
    },
    channels: {
      fetch: mock(async () => ({
        isTextBased: () => true,
        messages: {
          fetch: options.fetchError
            ? mock(async () => {
                throw options.fetchError;
              })
            : mock(async () => options.posted ?? v2Message(null)),
        },
      })),
    },
  } as unknown as Client;
  const guildConfigRepository = {
    findByGuildId: mock(async () => ({
      loggingSettings: {
        modLogChannel:
          options.modLogChannel === undefined
            ? LOG_CHANNEL
            : options.modLogChannel,
        modLogEnabled: true,
      },
    })),
  } as unknown as GuildConfigRepository;
  const emojiRepository = {
    getEmojis: mock(async (names: readonly string[]) =>
      Object.fromEntries(names.map((n) => [n, ""])),
    ),
  } as unknown as BotEmojiRepository;

  return {
    patch,
    markDmDeleted,
    service: new ModLogMessageService(
      client,
      guildConfigRepository,
      emojiRepository,
      { markDmDeleted },
      pino({ level: "silent" }),
    ),
  };
}

function text(message: ModLogMessage): string {
  return JSON.stringify(message.components[0]?.toJSON());
}

describe("ModLogMessageService.refresh", () => {
  test("edits a components v2 entry, keeping its facts block", async () => {
    const posted = v2Message("-# Timeout would have ended <t:1:R>");
    const { service, patch } = setup({ posted });

    expect(
      await service.refresh(makeCase({ actionType: ActionType.TimeoutRemove })),
    ).toBe("updated");

    expect(patch).not.toHaveBeenCalled();
    const [payload] = posted.edit.mock.calls[0] as unknown as [ModLogMessage];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(text(payload)).toContain("Timeout would have ended <t:1:R>");
  });

  test("converts a legacy embed entry over REST with content null", async () => {
    const posted = legacyMessage([
      { name: "Timeout Duration", value: "1 hour\nExpiring <t:5:R>" },
      { name: "Previous Timeout", value: "Would have expired <t:3:R>" },
    ]);
    const { service, patch } = setup({ posted });

    expect(
      await service.refresh(
        makeCase({
          actionType: ActionType.TimeoutAdjust,
          timeoutDuration: null,
        }),
      ),
    ).toBe("updated");

    expect(posted.edit).not.toHaveBeenCalled();
    const [route, { body }] = patch.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(route).toBe(Routes.channelMessage(LOG_CHANNEL, LOG_MESSAGE));
    expect(Object.keys(body).sort()).toEqual([
      "allowed_mentions",
      "components",
      "content",
      "embeds",
      "flags",
    ]);
    expect(body.content).toBeNull();
    expect(body.embeds).toEqual([]);
    expect(body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    const components = JSON.stringify(body.components);
    expect(components).toContain("Timeout Duration: 1 hour · Expiring <t:5:R>");
    expect(components).toContain(
      "Previous Timeout: Would have expired <t:3:R>",
    );
  });

  test("a legacy entry showing the DM as deleted is stored as deleted first", async () => {
    const posted = legacyMessage([], "Reason DM deleted");
    const { service, patch, markDmDeleted } = setup({ posted });

    const entry = await service.loadEntry(makeCase());

    expect(markDmDeleted).toHaveBeenCalledWith(GUILD, "4822", null, null);
    expect(entry.moderationCase.dmDeleted).toBe(true);

    await service.refreshEntry(entry, entry.moderationCase);
    const body = (
      patch.mock.calls[0] as unknown as [
        string,
        { body: { components: unknown[] } },
      ]
    )[1].body;
    expect(JSON.stringify(body.components)).toContain("Reason DM deleted");
    expect(JSON.stringify(body.components)).not.toContain("Delete DM");
  });

  test("a pending case has no message yet", async () => {
    const { service } = setup();

    expect(
      await service.refresh(makeCase({ msgId: null, pending: true })),
    ).toBe("pending");
    expect(await service.refresh(makeCase({ msgId: null }))).toBe("no_message");
  });

  test("no mod log channel", async () => {
    const { service } = setup({ modLogChannel: null });

    expect(await service.refresh(makeCase())).toBe("not_configured");
  });

  test("a message that can't be fetched or edited is returned, not thrown", async () => {
    expect(
      await setup({ fetchError: new Error("Unknown Message") }).service.refresh(
        makeCase(),
      ),
    ).toBe("failed");

    const posted = v2Message(null);
    posted.edit.mockRejectedValueOnce(new Error("Missing Access"));
    expect(await setup({ posted }).service.refresh(makeCase())).toBe("failed");
  });
});

describe("ModLogMessageService.render", () => {
  test("keeps the recorded target name and names the executor in plain text", async () => {
    const { service } = setup();

    const json = text(await service.render(makeCase()));

    expect(json).toContain(`<@${TARGET}> spambot`);
    expect(json).not.toContain("renamed_now");
    expect(json).toContain(`by <@${EXECUTOR}> (tzuyu)`);
  });

  test("falls back to a default avatar when the user can't be fetched", async () => {
    const { service } = setup({
      userFetch: mock(async () => {
        throw new Error("Unknown User");
      }),
    });

    const json = text(await service.render(makeCase()));

    expect(json).toContain(`<@${TARGET}> spambot`);
    expect(json).toMatch(/embed\/avatars\/\d\.png/);
  });
});

describe("ModLogMessageService.updateFromInteraction", () => {
  test("a failed legacy conversion is returned, never thrown, after the ack", async () => {
    const { service, patch } = setup();
    patch.mockRejectedValueOnce(new Error("Invalid Form Body"));
    const interaction = {
      message: legacyMessage([], "Reason DM sent", true) as unknown as Message,
      update: mock(async () => undefined),
      deferUpdate: mock(async () => undefined),
      editReply: mock(async () => undefined),
    };

    const outcome = await service.updateFromInteraction(
      interaction as never,
      await service.render(makeCase()),
    );

    expect(outcome).toBe("failed");
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    const [, { body }] = patch.mock.calls[0] as unknown as [
      string,
      { body: { flags: number } },
    ];
    expect(body.flags).toBe(
      MessageFlags.SuppressEmbeds | MessageFlags.IsComponentsV2,
    );
  });

  test("a components v2 entry is updated through the interaction", async () => {
    const { service, patch } = setup();
    const interaction = {
      message: v2Message(null),
      update: mock(async () => undefined),
      deferUpdate: mock(async () => undefined),
    };
    const message = await service.render(makeCase());

    expect(
      await service.updateFromInteraction(interaction as never, message),
    ).toBe("updated");

    expect(interaction.update).toHaveBeenCalledWith(message);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  test("a legacy entry is acknowledged, then converted over REST", async () => {
    const { service, patch } = setup();
    const interaction = {
      message: legacyMessage([]) as unknown as Message,
      update: mock(async () => undefined),
      deferUpdate: mock(async () => undefined),
    };
    const message = await service.render(makeCase());

    await service.updateFromInteraction(interaction as never, message);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      Routes.channelMessage(LOG_CHANNEL, LOG_MESSAGE),
      {
        body: {
          flags: MessageFlags.IsComponentsV2,
          components: message.components.map((c) => c.toJSON()),
          embeds: [],
          content: null,
          allowed_mentions: { parse: [] },
        },
      },
    );
  });
});
