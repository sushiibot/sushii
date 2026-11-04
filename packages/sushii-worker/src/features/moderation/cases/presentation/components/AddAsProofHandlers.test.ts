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

function sourceMessage(content = "I'm giving away free nitro, claim here") {
  return {
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
    result?: Awaited<
      ReturnType<AddAsProofButtonHandler["deps"]["caseProofService"]["add"]>
    >;
    permitted?: boolean;
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
  const add = mock(
    async () =>
      options.result ??
      Ok<AddProofResult>({
        proofs: [proof()],
        cases: [makeCase()],
        skipped: [],
      }),
  );
  const deps = {
    modLogRepository: { findNewestByUser },
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
    messages: { fetch: fetchMessage },
  };

  function component(customId: string, extra: Record<string, unknown> = {}) {
    return {
      customId,
      guildId: GUILD,
      user: { id: MOD },
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
      default_member_permissions: "4",
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

    expect(interaction.deferUpdate).toHaveBeenCalled();
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

  test("a refusal is private and leaves the picker", async () => {
    const ctx = setup({ result: Err("too_many_files") });
    const interaction = ctx.component(ADD_ID);
    await new AddAsProofButtonHandler(ctx.deps as never).handleInteraction(
      interaction as unknown as ButtonInteraction,
    );

    expect(interaction.editReply).not.toHaveBeenCalled();
    const [payload] = interaction.followUp.mock.calls[0] as [{ flags: number }];
    expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(json(interaction.followUp.mock.calls[0])).toContain(
      "A case holds up to 10 proof files.",
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
      expect(json(interaction.followUp.mock.calls[0])).toContain(
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

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
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
