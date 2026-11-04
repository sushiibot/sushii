import { describe, expect, mock, test } from "bun:test";
import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ContextMenuCommandInteraction,
} from "discord.js";
import { DiscordAPIError, MessageFlags, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import {
  GUILD,
  MOD,
  TARGET,
  TARGET_3,
  botEmoji,
  makeCase,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { AddProofResult } from "../../application/CaseProofService";
import { AddAsProofContextMenuHandler } from "../commands/AddAsProofContextMenuHandler";
import {
  ADD_AS_PROOF_EMOJIS,
  SOURCE_SHORTENED_LINE,
  buildAddAsProofCustomId,
} from "../views/AddAsProofView";
import {
  AddAsProofButtonHandler,
  AddAsProofSelectHandler,
  SOURCE_MESSAGE_GONE_TEXT,
} from "./AddAsProofHandlers";

const CHANNEL = "1029384756102938401";
const MESSAGE = "1029384756102938499";
const URL = `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`;
const NOW = new Date("2026-10-27T13:00:00.000Z");

function attachments(list: { url: string; name: string; size: number }[]) {
  return {
    map: <T>(fn: (a: (typeof list)[number] & { contentType: string }) => T) =>
      list.map((a) => fn({ ...a, contentType: "image/png" })),
  };
}

function sourceMessage(
  content = "I'm giving away free nitro, claim here",
  snapshot?: { content: string; attachments: ReturnType<typeof attachments> },
) {
  return {
    messageSnapshots: { first: () => snapshot },
    id: MESSAGE,
    channelId: CHANNEL,
    url: URL,
    author: { id: TARGET, username: "spambot" },
    content,
    attachments: attachments([
      {
        url: "https://cdn.discordapp.com/attachments/1/2/scam.png",
        name: "scam.png",
        size: 1000,
      },
    ]),
  };
}

function proof(): CaseProof {
  return {
    id: "1",
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    createdAt: NOW,
    content: null,
    attachments: ["https://cdn.discordapp.com/attachments/9/9/scam.png"],
    sourceMessageUrl: URL,
    sourceAuthorId: TARGET,
    sourceContent: "I'm giving away free nitro, claim here",
    hostMessageId: "1029384756102938500",
    source: "context_menu",
  };
}

function setup(
  options: {
    cases?: Record<string, ModerationCase[]>;
    /** One per add call, in order; the last repeats. */
    results?: AddResult[];
    permitted?: boolean;
    canRead?: boolean;
    modLogChannel?: string | null;
    message?: ReturnType<typeof sourceMessage> | "deleted" | "foreign";
  } = {},
) {
  const casesByUser = options.cases ?? {
    [TARGET]: [makeCase(), makeCase({ caseId: "4801" })],
    [TARGET_3]: [makeCase({ caseId: "4824", userId: TARGET_3 })],
  };
  const findNewestByUser = mock(
    async (_g: string, userId: string, _l: number) => casesByUser[userId] ?? [],
  );
  const results = options.results ?? [
    Ok<AddProofResult>({ proofs: [proof()], cases: [makeCase()], skipped: [] }),
  ];
  let calls = 0;
  const add = mock(
    async (_input: unknown) => results[Math.min(calls++, results.length - 1)],
  );
  const deps = {
    modLogRepository: { findNewestByUser },
    guildConfigRepository: {
      findByGuildId: mock(async () => {
        const config = GuildConfig.createDefault(GUILD);
        config.loggingSettings.modLogChannel =
          options.modLogChannel === undefined
            ? "1029384756102938400"
            : options.modLogChannel;
        return config;
      }),
    },
    caseProofService: { add },
    emojiRepository: {
      getEmojis: mock(async () =>
        Object.fromEntries(ADD_AS_PROOF_EMOJIS.map((n) => [n, botEmoji(n)])),
      ),
    },
    logger: pino({ level: "silent" }),
    now: () => NOW,
  };

  const message = options.message ?? sourceMessage();
  const fetchMessage = mock(async () => {
    if (message === "deleted") {
      throw new DiscordAPIError(
        { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
        RESTJSONErrorCodes.UnknownMessage,
        404,
        "GET",
        "/channels/x/messages/y",
        {},
      );
    }
    return message;
  });
  const channel = {
    guildId: message === "foreign" ? "1" : GUILD,
    isDMBased: () => false,
    isTextBased: () => true,
    permissionsFor: mock(() => ({ has: () => options.canRead ?? true })),
    messages: { fetch: fetchMessage },
  };

  function component(customId: string, extra: Record<string, unknown> = {}) {
    return {
      customId,
      guildId: GUILD,
      user: { id: MOD },
      member: { id: MOD },
      attachmentSizeLimit: 10 * 1024 * 1024,
      client: { channels: { fetch: mock(async () => channel) } },
      memberPermissions: { any: () => options.permitted ?? true },
      inCachedGuild: () => true,
      reply: mock(async (_o: unknown) => undefined),
      update: mock(async (_o: unknown) => undefined),
      deferUpdate: mock(async () => undefined),
      editReply: mock(async (_o: unknown) => undefined),
      followUp: mock(async (_o: unknown) => undefined),
      ...extra,
    };
  }

  return { deps, add, findNewestByUser, fetchMessage, component };
}

interface AddInput {
  files: unknown[];
  source: unknown;
  fallback: boolean;
}

type AddResult = Awaited<
  ReturnType<AddAsProofButtonHandler["deps"]["caseProofService"]["add"]>
>;

function stored(attachments: string[], sourceContent: string | null = "x") {
  return Ok<AddProofResult>({
    proofs: [{ ...proof(), attachments, sourceContent }],
    cases: [makeCase()],
    skipped: [],
  });
}

function json(call: unknown[] | undefined): string {
  const [payload] = (call ?? []) as [{ components: { toJSON(): unknown }[] }];
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

const ADD_ID = buildAddAsProofCustomId({
  kind: "add",
  caseId: "4822",
  channelId: CHANNEL,
  messageId: MESSAGE,
});
const PICK_ID = buildAddAsProofCustomId({
  kind: "pick",
  channelId: CHANNEL,
  messageId: MESSAGE,
});
const USER_ID = buildAddAsProofCustomId({
  kind: "user",
  channelId: CHANNEL,
  messageId: MESSAGE,
});

describe("Add as proof context menu", () => {
  test("opens a private picker of the author's cases", async () => {
    const ctx = setup();
    const handler = new AddAsProofContextMenuHandler(ctx.deps as never);
    const reply = mock(async (_o: unknown) => undefined);
    await handler.handler({
      guildId: GUILD,
      inCachedGuild: () => true,
      isMessageContextMenuCommand: () => true,
      targetMessage: sourceMessage(),
      reply,
    } as unknown as ContextMenuCommandInteraction);

    expect(ctx.findNewestByUser).toHaveBeenCalledWith(GUILD, TARGET, 10);
    const [payload] = reply.mock.calls[0] as [{ flags: number }];
    expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    const out = json(reply.mock.calls[0]);
    expect(out).toContain("Add to #4822");
    expect(out).toContain('"value":"4801"');
  });

  test("is limited to mods by default and only in servers", () => {
    const handler = new AddAsProofContextMenuHandler(setup().deps as never);
    expect(handler.command).toMatchObject({
      name: "Add as proof",
      type: 3,
      default_member_permissions: "1099511627776",
      contexts: [0],
    });
  });
});

describe("Add as proof pick", () => {
  test("the button adds the refetched message with its link, text and images", async () => {
    const ctx = setup();
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.client.channels.fetch).toHaveBeenCalledWith(CHANNEL);
    expect(ctx.fetchMessage).toHaveBeenCalledWith(MESSAGE);
    expect(ctx.add).toHaveBeenCalledWith({
      guildId: GUILD,
      caseIds: ["4822"],
      authorId: MOD,
      kind: "context_menu",
      content: null,
      files: [
        {
          url: "https://cdn.discordapp.com/attachments/1/2/scam.png",
          name: "scam.png",
          size: 1000,
          contentType: "image/png",
        },
      ],
      source: {
        url: URL,
        authorId: TARGET,
        content: "I'm giving away free nitro, claim here",
      },
      uploadLimit: 10 * 1024 * 1024,
      fallback: false,
    });
    expect(json(interaction.editReply.mock.calls[0])).toContain(
      "✅ Added to case #4822 as proof",
    );
  });

  test("stores long message text capped", async () => {
    const ctx = setup({ message: sourceMessage("spam ".repeat(500)) });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    const [input] = ctx.add.mock.calls[0] as unknown as [
      { source: { content: string } },
    ];
    expect(input.source.content.length).toBeLessThanOrEqual(1500);
    expect(input.source.content.endsWith(SOURCE_SHORTENED_LINE)).toBe(true);
  });

  test("the select adds to the picked case", async () => {
    const ctx = setup();
    const interaction = ctx.component(PICK_ID, {
      values: ["4801"],
      isUserSelectMenu: () => false,
    });
    await new AddAsProofSelectHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as AnySelectMenuInteraction,
    );

    expect(ctx.add.mock.calls[0]).toMatchObject([{ caseIds: ["4801"] }]);
  });

  test("the first click replaces the picker with a state that can't be clicked again", async () => {
    const ctx = setup();
    const interaction = ctx.component(ADD_ID);
    const order: string[] = [];
    interaction.update.mockImplementation(async () => {
      order.push("update");
    });
    ctx.add.mockImplementation(async () => {
      order.push("add");
      return stored(["https://cdn.discordapp.com/attachments/9/9/scam.png"]);
    });
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(order).toEqual(["update", "add"]);
    const adding = json(interaction.update.mock.calls[0]);
    expect(adding).toContain("Adding the message to case #4822…");
    expect(adding).not.toMatch(/"type":(2|3|5)\b/);
    expect(adding).not.toContain("proof/ctx/");
  });

  test("an unrelated refusal replaces the picker with the error", async () => {
    const ctx = setup({ results: [Err("cases_not_found")] });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(ctx.add).toHaveBeenCalledTimes(1);
    const out = json(interaction.editReply.mock.calls[0]);
    expect(out).toContain("This case was deleted");
    expect(out).toContain("-# Right-click the message to try again.");
  });

  test("an unexpected failure is shown in the picker, not thrown", async () => {
    const ctx = setup();
    ctx.add.mockImplementation(async () => {
      throw new Error("Discord down");
    });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(JSON.stringify(interaction.editReply.mock.calls[0])).toContain(
      "Couldn't add proof",
    );
  });

  const noEntry = Err({
    kind: "not_added" as const,
    skipped: [{ caseId: "4822", reason: "no_mod_log_for_files" as const }],
  });
  const fallbacks: [string, AddResult, string, (string | null)?][] = [
    [
      "no mod log channel",
      noEntry,
      "-# Files weren't saved: this case has no mod log entry to keep them on. Set a mod log channel in `/settings`.",
      null,
    ],
    [
      "no entry for the case",
      noEntry,
      "-# Files weren't saved: this case has no mod log entry to keep them on.\"",
    ],
    [
      "a file over the limit",
      Err("file_too_large" as const),
      "-# Files weren't saved: one is over the 10 MB limit.",
    ],
    [
      "too many files",
      Err("too_many_files" as const),
      "-# Files weren't saved: a case holds up to 10 proof files.",
    ],
  ];

  for (const [name, refusal, note, modLogChannel] of fallbacks) {
    test(`with ${name}, still saves the link and text`, async () => {
      const ctx = setup({ results: [refusal, stored([])], modLogChannel });
      const interaction = ctx.component(ADD_ID);
      await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
        interaction as unknown as ButtonInteraction,
      );

      expect(ctx.add).toHaveBeenCalledTimes(2);
      const [first] = ctx.add.mock.calls[0] as [AddInput];
      const [retry] = ctx.add.mock.calls[1] as [AddInput];
      expect(first.files).toHaveLength(1);
      expect(first.fallback).toBe(false);
      expect(retry.files).toEqual([]);
      expect(retry.fallback).toBe(true);
      expect(retry.source).toEqual(first.source);

      const out = json(interaction.editReply.mock.calls[0]);
      expect(out).toContain("✅ Added to case #4822 as proof");
      expect(out).toContain("-# Message link and text saved");
      expect(out).not.toContain("image saved");
      expect(out).toContain(note);
    });
  }

  test("a mixed skip isn't retried without files", async () => {
    const ctx = setup({
      results: [
        Err({
          kind: "not_added" as const,
          skipped: [{ caseId: "4822", reason: "retry_later" as const }],
        }),
      ],
    });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(ctx.add).toHaveBeenCalledTimes(1);
    const out = json(interaction.editReply.mock.calls[0]);
    expect(out).toContain("still being posted");
    expect(out).toContain("-# Right-click the message to try again.");
  });

  test("the confirmation counts the stored files, not the message's", async () => {
    const ctx = setup({
      results: [
        stored([
          "https://cdn.discordapp.com/attachments/9/9/a.png",
          "https://cdn.discordapp.com/attachments/9/9/b.png",
        ]),
      ],
    });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(json(interaction.editReply.mock.calls[0])).toContain(
      "-# Message link, text and 2 images saved",
    );
  });

  test("a forwarded message adds the forwarded text and files", async () => {
    const ctx = setup({
      message: sourceMessage("", {
        content: "forwarded scam text",
        attachments: attachments([
          {
            url: "https://cdn.discordapp.com/attachments/1/2/fwd.png",
            name: "fwd.png",
            size: 5,
          },
        ]),
      }),
    });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(ctx.add.mock.calls[0]).toMatchObject([
      {
        files: [{ name: "fwd.png" }],
        source: {
          url: URL,
          authorId: null,
          content: `Forwarded by <@${TARGET}>\nforwarded scam text`,
        },
      },
    ]);
  });

  test("a clicker who can't read the channel gets the can't-read text", async () => {
    const ctx = setup({ canRead: false });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(ctx.add).not.toHaveBeenCalled();
    expect(json(interaction.editReply.mock.calls[0])).toContain(
      SOURCE_MESSAGE_GONE_TEXT,
    );
  });

  for (const gone of ["deleted", "foreign"] as const) {
    test(`a ${gone} message is reported, nothing is added`, async () => {
      const ctx = setup({ message: gone });
      const interaction = ctx.component(ADD_ID);
      await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
        interaction as unknown as ButtonInteraction,
      );

      expect(ctx.add).not.toHaveBeenCalled();
      expect(json(interaction.editReply.mock.calls[0])).toContain(
        SOURCE_MESSAGE_GONE_TEXT,
      );
    });
  }

  test("someone without mod permissions is refused", async () => {
    const ctx = setup({ permitted: false });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(interaction.update).not.toHaveBeenCalled();
    expect(ctx.add).not.toHaveBeenCalled();
    expect(json(interaction.reply.mock.calls[0])).toContain(
      "You need **Ban Members, Kick Members, or Timeout Members**",
    );
  });

  test("the user select is refused without mod permissions too", async () => {
    const ctx = setup({ permitted: false });
    const interaction = ctx.component(USER_ID, {
      isUserSelectMenu: () => true,
    });
    await new AddAsProofSelectHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as AnySelectMenuInteraction,
    );

    expect(interaction.update).not.toHaveBeenCalled();
    expect(ctx.findNewestByUser).not.toHaveBeenCalled();
  });
});

describe("Add as proof forwards", () => {
  test("a forward opens with only the user select, since its author isn't known", async () => {
    const ctx = setup();
    const handler = new AddAsProofContextMenuHandler(ctx.deps as never);
    const reply = mock(async (_o: unknown) => undefined);
    await handler.handler({
      guildId: GUILD,
      inCachedGuild: () => true,
      isMessageContextMenuCommand: () => true,
      targetMessage: sourceMessage("", {
        content: "forwarded scam text",
        attachments: attachments([]),
      }),
      reply,
    } as unknown as ContextMenuCommandInteraction);

    expect(ctx.findNewestByUser).not.toHaveBeenCalled();
    const out = json(reply.mock.calls[0]);
    expect(out).toContain("> forwarded scam text");
    expect(out).toContain(
      `-# Forwarded message, sent by <@${TARGET}> in <#${CHANNEL}>`,
    );
    expect(out).toContain("Forwards don't say who first wrote them.");
    expect(out).not.toContain("Add to #");
    expect(out).toContain("Someone else's case…");
  });
});

describe("Add as proof user select on a forward", () => {
  test("picking the forwarder lists their cases", async () => {
    const ctx = setup({
      message: sourceMessage("", {
        content: "forwarded scam text",
        attachments: attachments([]),
      }),
    });
    const interaction = ctx.component(USER_ID, {
      isUserSelectMenu: () => true,
      users: { first: () => ({ id: TARGET, username: "spambot" }) },
    });
    await new AddAsProofSelectHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as AnySelectMenuInteraction,
    );

    expect(ctx.findNewestByUser).toHaveBeenCalledWith(GUILD, TARGET, 10);
    const out = json(interaction.update.mock.calls[0]);
    expect(out).toContain("Add to #4822");
    expect(out).toContain(`-# Showing <@${TARGET}>'s cases`);
  });
});

describe("Add as proof user select", () => {
  test("shows the picked user's cases in place", async () => {
    const ctx = setup();
    const interaction = ctx.component(USER_ID, {
      isUserSelectMenu: () => true,
      users: { first: () => ({ id: TARGET_3, username: "raider_99" }) },
    });
    await new AddAsProofSelectHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as AnySelectMenuInteraction,
    );

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(ctx.findNewestByUser).toHaveBeenCalledWith(GUILD, TARGET_3, 10);
    const [payload] = interaction.update.mock.calls[0] as [{ flags: number }];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const out = json(interaction.update.mock.calls[0]);
    expect(out).toContain(`-# Showing <@${TARGET_3}>'s cases`);
    expect(out).toContain("Add to #4824");
  });

  test("picking someone without cases says so", async () => {
    const ctx = setup({ cases: {} });
    const interaction = ctx.component(USER_ID, {
      isUserSelectMenu: () => true,
      users: { first: () => ({ id: TARGET_3, username: "raider_99" }) },
    });
    await new AddAsProofSelectHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as AnySelectMenuInteraction,
    );

    expect(json(interaction.update.mock.calls[0])).toContain(
      `<@${TARGET_3}> has no cases.`,
    );
  });
});
