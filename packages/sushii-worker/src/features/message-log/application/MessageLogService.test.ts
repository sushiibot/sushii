import { describe, expect, mock, test } from "bun:test";
import type { APIEmbed, Client } from "discord.js";
import pino from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type {
  MessageLogPostRepository,
  NewMessageLogPost,
} from "../domain/repositories/MessageLogPostRepository";
import type {
  GuildMessageDeleteBulkPayload,
  GuildMessageDeletePayload,
  GuildMessageUpdatePayload,
} from "../domain/types/GuildMessagePayloads";
import type { MessageData } from "../domain/types/MessageData";
import type { MessageDeleteAuditLogCache } from "./MessageDeleteAuditLogCache";
import { MessageLogService, chunkEntries } from "./MessageLogService";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const LOG_CHANNEL = "300000000000000009";
const MESSAGE = "500000000000000001";
const MEMBER = "200000000000000001";
const APP = "400000000000000002";
const TRIGGERING_USER = "200000000000000002";

function cachedEvent(overrides: Partial<MessageData> = {}): MessageLogEvent {
  const authorId = overrides.author?.id ?? MEMBER;
  return new MessageLogEvent(
    MESSAGE,
    authorId,
    CHANNEL,
    GUILD,
    "original",
    new Date("2026-03-10T12:00:00.000Z"),
    {
      id: MESSAGE,
      channel_id: CHANNEL,
      type: 0,
      author: {
        id: MEMBER,
        username: "member",
        discriminator: "0",
        avatar: null,
        bot: false,
        global_name: null,
      },
      content: "original",
      timestamp: "2026-03-10T12:00:00.000Z",
      ...overrides,
    },
  );
}

function setup(
  event: MessageLogEvent | MessageLogEvent[],
  options: { blocked?: boolean } = {},
) {
  const config = GuildConfig.createDefault(GUILD);
  config.loggingSettings.messageLogEnabled = true;
  config.loggingSettings.messageLogChannel = LOG_CHANNEL;

  let sentCount = 0;
  const send = mock(async (_opts: { embeds: APIEmbed[] }) => {
    sentCount += 1;
    return { id: `70000000000000000${sentCount}` };
  });
  const defaultAvatar = mock(
    (_index: number) => "https://cdn.example/default.png",
  );
  const client = {
    channels: {
      cache: {
        get: () => ({ isSendable: () => true, send }),
      },
    },
    rest: {
      cdn: {
        avatar: () => "https://cdn.example/avatar.png",
        defaultAvatar,
        sticker: () => "https://cdn.example/sticker.png",
      },
    },
  } as unknown as Client;

  const events = Array.isArray(event) ? event : [event];
  const findByMessageIds = mock(async () => events);
  const saveMany = mock(
    async (_rows: NewMessageLogPost[]): Promise<void> => undefined,
  );

  const service = new MessageLogService(
    client,
    { findByMessageIds } as unknown as MessageLogEventRepository,
    {
      findByGuildAndChannel: async () => (options.blocked ? {} : null),
    } as unknown as MessageLogBlockRepository,
    { saveMany } as unknown as MessageLogPostRepository,
    {
      findByGuildId: async () => config,
    } as unknown as GuildConfigRepository,
    {
      getEmojis: async () => ({ message_delete: "🗑", message_edit: "✏" }),
    } as unknown as BotEmojiRepository,
    {
      waitForExecutor: async () => null,
    } as unknown as MessageDeleteAuditLogCache,
    pino({ level: "silent" }),
  );

  return { service, send, findByMessageIds, defaultAvatar, saveMany };
}

function updatePayload(bot: boolean): GuildMessageUpdatePayload {
  return {
    id: MESSAGE,
    guild_id: GUILD,
    channel_id: CHANNEL,
    author: {
      id: bot ? APP : MEMBER,
      username: bot ? "app" : "member",
      discriminator: "0",
      avatar: null,
      global_name: null,
      bot,
    },
    content: "edited",
    timestamp: "2026-03-10T12:00:00.000Z",
  } as unknown as GuildMessageUpdatePayload;
}

const TRIGGERED_BY_FIELD = {
  name: "App response triggered by",
  value: `<@${TRIGGERING_USER}> · \`${TRIGGERING_USER}\``,
};

const deletePayload = {
  id: MESSAGE,
  guild_id: GUILD,
  channel_id: CHANNEL,
} as GuildMessageDeletePayload;

function appEvent(owners: Record<string, string>): MessageLogEvent {
  return cachedEvent({
    author: {
      id: APP,
      username: "app",
      discriminator: "0",
      avatar: null,
      bot: true,
      global_name: null,
    },
    interaction_metadata: {
      id: "600000000000000001",
      type: 2,
      user_id: TRIGGERING_USER,
      authorizing_integration_owners: owners,
    },
  });
}

describe("MessageLogService edit log", () => {
  test("posts an edit log for member edits", async () => {
    const { service, send } = setup(cachedEvent());

    await service.handleRawMessageUpdate(updatePayload(false));

    expect(send).toHaveBeenCalledTimes(1);
  });

  test("never posts an edit log for bot authors", async () => {
    const { service, send, findByMessageIds } = setup(appEvent({}));

    await service.handleRawMessageUpdate(updatePayload(true));

    expect(send).not.toHaveBeenCalled();
    expect(findByMessageIds).not.toHaveBeenCalled();
  });

  test("skips the edit log when the cached author is a bot", async () => {
    const { service, send } = setup(appEvent({}));

    await service.handleRawMessageUpdate(updatePayload(false));

    expect(send).not.toHaveBeenCalled();
  });
});

describe("MessageLogService delete embed", () => {
  test("member messages have no app fields and keep the plain footer", async () => {
    const { service, send } = setup(cachedEvent());

    await service.handleRawMessageDelete(deletePayload);

    expect(send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          fields: [],
          footer: { text: `Message ID: ${MESSAGE}` },
        }),
      ],
    });
  });

  test("user-installed app responses show who triggered them", async () => {
    const { service, send } = setup(appEvent({ "1": TRIGGERING_USER }));

    await service.handleRawMessageDelete(deletePayload);

    expect(send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          fields: expect.arrayContaining([TRIGGERED_BY_FIELD]),
          footer: { text: `User-installed app · Message ID: ${MESSAGE}` },
        }),
      ],
    });
  });

  test("server app responses get the server app footer", async () => {
    const { service, send } = setup(appEvent({ "0": GUILD }));

    await service.handleRawMessageDelete(deletePayload);

    expect(send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          fields: expect.arrayContaining([TRIGGERED_BY_FIELD]),
          footer: { text: `Server app · Message ID: ${MESSAGE}` },
        }),
      ],
    });
  });

  test("server app footer wins when both install types authorized the command", async () => {
    const { service, send } = setup(
      appEvent({ "0": GUILD, "1": TRIGGERING_USER }),
    );

    await service.handleRawMessageDelete(deletePayload);

    expect(send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          footer: { text: `Server app · Message ID: ${MESSAGE}` },
        }),
      ],
    });
  });

  test("embed-only app responses fall back to the first embed's text", async () => {
    const app = appEvent({ "0": GUILD });
    const embedOnly = new MessageLogEvent(
      app.messageId,
      app.authorId,
      app.channelId,
      app.guildId,
      "",
      app.createdAt,
      {
        ...app.discordMessage,
        content: "",
        embeds: [
          { title: "Rank *card*", description: "Level 5" },
          { title: "ignored second embed" },
        ],
      },
    );
    const { service, send } = setup(embedOnly);

    await service.handleRawMessageDelete(deletePayload);

    const embed = send.mock.calls[0][0].embeds[0];
    expect(embed.description).toEndWith("Rank \\*card\\*\nLevel 5\n");
    expect(embed.description).not.toContain("ignored second embed");
  });

  test("truncates a long embed fallback by code points before escaping", async () => {
    const app = appEvent({ "0": GUILD });
    const embedOnly = new MessageLogEvent(
      app.messageId,
      app.authorId,
      app.channelId,
      app.guildId,
      "",
      app.createdAt,
      {
        ...app.discordMessage,
        content: "",
        embeds: [{ description: "😀*".repeat(3000) }],
      },
    );
    const { service, send } = setup(embedOnly);

    await service.handleRawMessageDelete(deletePayload);

    const description = send.mock.calls[0][0].embeds[0].description ?? "";
    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description).toEndWith("…\n");
    expect(description).not.toContain("\\…");
    expect(description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  test("uses the snowflake-based default avatar for migrated usernames", async () => {
    const { service, defaultAvatar } = setup(appEvent({ "0": GUILD }));

    await service.handleRawMessageDelete(deletePayload);

    expect(defaultAvatar).toHaveBeenCalledWith(
      Number((BigInt(APP) >> 22n) % 6n),
    );
  });

  test("uses the discriminator default avatar for legacy discriminators", async () => {
    const legacy = cachedEvent({
      author: {
        id: APP,
        username: "app",
        discriminator: "1237",
        avatar: null,
        bot: true,
        global_name: null,
      },
    });
    const { service, defaultAvatar } = setup(legacy);

    await service.handleRawMessageDelete(deletePayload);

    expect(defaultAvatar).toHaveBeenCalledWith(1237 % 5);
  });
});

function memberMessage(id: string, content: string): MessageLogEvent {
  const base = cachedEvent();
  return new MessageLogEvent(
    id,
    MEMBER,
    CHANNEL,
    GUILD,
    content,
    base.createdAt,
    { ...base.discordMessage, id, content },
  );
}

const bulkPayload = (ids: string[]) =>
  ({
    ids,
    guild_id: GUILD,
    channel_id: CHANNEL,
  }) as GuildMessageDeleteBulkPayload;

describe("chunkEntries", () => {
  test("never splits an entry and attaches each id to exactly one chunk", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({
      text: `entry-${i}:` + "x".repeat(300 + i * 7),
      messageId: String(i),
    }));

    const chunks = chunkEntries("header", entries, 4096);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.messageIds)).toEqual(
      entries.map((e) => e.messageId),
    );
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
      for (const id of chunk.messageIds) {
        const entry = entries[Number(id)];
        expect(chunk.text).toContain(entry.text);
      }
    }
  });

  test("counts the joiner so a chunk never exceeds the limit", () => {
    const chunks = chunkEntries(
      "a".repeat(10),
      [{ text: "b".repeat(10), messageId: "1" }],
      20,
    );

    expect(chunks).toEqual([
      { text: "a".repeat(10), messageIds: [] },
      { text: "b".repeat(10), messageIds: ["1"] },
    ]);
  });

  test("truncates an over-long entry by code points instead of splitting it", () => {
    const chunks = chunkEntries(
      "header",
      [{ text: "😀".repeat(3000), messageId: "1" }],
      4096,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[1].messageIds).toEqual(["1"]);
    expect(chunks[1].text.length).toBeLessThanOrEqual(4096);
    expect(chunks[1].text).toEndWith("😀…");
  });

  test("drops a dangling escape before the ellipsis", () => {
    const chunks = chunkEntries("", [{ text: "ab\\*cd", messageId: "1" }], 4);

    expect(chunks[0].text).toBe("ab…");
  });
});

describe("MessageLogService bulk delete", () => {
  test("human lines are unchanged", async () => {
    const { service, send } = setup([memberMessage(MESSAGE, "hello")]);

    await service.handleRawMessageDeleteBulk(bulkPayload([MESSAGE]));

    expect(send.mock.calls[0][0].embeds[0].description).toBe(
      `🗑 **1 messages deleted in <#${CHANNEL}>**\n<@${MEMBER}>: hello`,
    );
  });

  test("app replies fall back to the first embed and show who triggered them", async () => {
    const app = appEvent({ "1": TRIGGERING_USER });
    const embedOnly = new MessageLogEvent(
      app.messageId,
      app.authorId,
      app.channelId,
      app.guildId,
      "",
      app.createdAt,
      {
        ...app.discordMessage,
        content: "",
        embeds: [{ title: "Rank *card*", description: "Level 5" }],
      },
    );
    const { service, send } = setup([embedOnly]);

    await service.handleRawMessageDeleteBulk(bulkPayload([MESSAGE]));

    expect(send.mock.calls[0][0].embeds[0].description).toEndWith(
      `\n<@${APP}>: Rank \\*card\\*\nLevel 5 (triggered by <@${TRIGGERING_USER}>)`,
    );
  });

  test("app replies with content keep it and show who triggered them", async () => {
    const { service, send } = setup([appEvent({ "0": GUILD })]);

    await service.handleRawMessageDeleteBulk(bulkPayload([MESSAGE]));

    expect(send.mock.calls[0][0].embeds[0].description).toEndWith(
      `\n<@${APP}>: original (triggered by <@${TRIGGERING_USER}>)`,
    );
  });

  test("maps each message to the post that shows it", async () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      memberMessage(`5000000000000001${i}0`, `marker-${i} ${"y".repeat(1900)}`),
    );
    const { service, send, saveMany } = setup(events);

    await service.handleRawMessageDeleteBulk(
      bulkPayload(events.map((e) => e.messageId)),
    );

    expect(send.mock.calls.length).toBeGreaterThan(1);
    const rows = saveMany.mock.calls[0][0];
    expect(rows.map((r) => r.messageId).sort()).toEqual(
      events.map((e) => e.messageId).sort(),
    );
    for (const row of rows) {
      const postIndex = Number(row.logMessageId.slice(-1)) - 1;
      const marker = `marker-${events.findIndex((e) => e.messageId === row.messageId)} `;
      const descriptions = send.mock.calls[postIndex][0].embeds
        .map((e) => e.description)
        .join("\n");
      expect(descriptions).toContain(marker);
      expect(row.logChannelId).toBe(LOG_CHANNEL);
      expect(row.channelId).toBe(CHANNEL);
    }
  });

  test("blocked channels write no mappings", async () => {
    const { service, send, saveMany } = setup([memberMessage(MESSAGE, "hi")], {
      blocked: true,
    });

    await service.handleRawMessageDeleteBulk(bulkPayload([MESSAGE]));

    expect(send).not.toHaveBeenCalled();
    expect(saveMany).not.toHaveBeenCalled();
  });

  test("a failed mapping write does not throw", async () => {
    const { service, saveMany } = setup([memberMessage(MESSAGE, "hi")]);
    saveMany.mockImplementation(async () => {
      throw new Error("db down");
    });

    await service.handleRawMessageDeleteBulk(bulkPayload([MESSAGE]));

    expect(saveMany).toHaveBeenCalledTimes(1);
  });
});

describe("MessageLogService partial send", () => {
  test("maps only messages in posts that were actually sent", async () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      memberMessage(`5000000000000002${i}0`, `marker-${i} ${"y".repeat(3000)}`),
    );
    const { service, send, saveMany } = setup(events);
    send.mockImplementationOnce(async () => ({ id: "700000000000000001" }));
    send.mockImplementation(async () => {
      throw new Error("Missing Access");
    });

    await service.handleRawMessageDeleteBulk(
      bulkPayload(events.map((e) => e.messageId)),
    );

    expect(send.mock.calls.length).toBeGreaterThan(1);
    const rows = saveMany.mock.calls[0][0];
    const firstPost = send.mock.calls[0][0].embeds
      .map((e) => e.description)
      .join("\n");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(events.length);
    for (const row of rows) {
      const i = events.findIndex((e) => e.messageId === row.messageId);
      expect(firstPost).toContain(`marker-${i} `);
      expect(row.logMessageId).toBe("700000000000000001");
    }
  });
});
