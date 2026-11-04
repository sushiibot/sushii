import { describe, expect, mock, test } from "bun:test";
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import {
  GUILD,
  MOD,
  TARGET,
  botEmoji,
  makeCase,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { AddProofResult } from "../../application/CaseProofService";
import {
  PROOF_COMMAND_EMOJIS,
  formatProofCaseChoice,
} from "../views/ProofCommandView";
import {
  ProofCaseAutocomplete,
  ProofCommand,
  parseProofCaseOption,
} from "./ProofCommand";

const MOD_LOG_CHANNEL = "1029384756102938400";
const ENTRY_ID = "1029384756102938499";
const NOW = new Date("2026-10-27T13:00:00.000Z");
const MB = 1024 * 1024;

function proof(overrides: Partial<CaseProof> = {}): CaseProof {
  return {
    id: "1",
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    createdAt: NOW,
    content: "Same scam DMs sent to two more members",
    attachments: [
      "https://cdn.discordapp.com/attachments/1/2/ticket-1.png?ex=1",
      "https://cdn.discordapp.com/attachments/1/3/ticket-2.png?ex=1",
    ],
    sourceMessageUrl: null,
    sourceAuthorId: null,
    sourceContent: null,
    hostMessageId: ENTRY_ID,
    source: "command",
    ...overrides,
  };
}

interface FileOption {
  url: string;
  name: string;
  size: number;
  contentType: string | null;
}

function file(name: string, size = MB): FileOption {
  return {
    url: `https://cdn.discordapp.com/ephemeral-attachments/1/2/${name}`,
    name,
    size,
    contentType: "image/png",
  };
}

function setup(options: {
  caseOption?: string;
  text?: string | null;
  files?: FileOption[];
  cases?: ModerationCase[];
  existingFiles?: number;
  modLogChannel?: string | null;
  result?: Awaited<ReturnType<ProofCommand["deps"]["caseProofService"]["add"]>>;
  addThrows?: boolean;
}) {
  const config = GuildConfig.createDefault(GUILD);
  config.loggingSettings.modLogChannel =
    options.modLogChannel === undefined
      ? MOD_LOG_CHANNEL
      : options.modLogChannel;

  const cases = options.cases ?? [makeCase()];
  const add = mock(async () => {
    if (options.addThrows) {
      throw new Error("Discord down");
    }
    return (
      options.result ??
      Ok<AddProofResult>({ proofs: [proof()], cases, skipped: [] })
    );
  });
  const deps = {
    modLogRepository: { findByIds: mock(async () => cases) },
    caseProofRepository: {
      countsByCases: mock(
        async () =>
          new Map([
            ["4822", { entries: 1, files: options.existingFiles ?? 0 }],
          ]),
      ),
    },
    guildConfigRepository: { findByGuildId: mock(async () => config) },
    caseProofService: { add },
    emojiRepository: {
      getEmojis: mock(async () =>
        Object.fromEntries(PROOF_COMMAND_EMOJIS.map((n) => [n, botEmoji(n)])),
      ),
    },
    logger: pino({ level: "silent" }),
  };
  const command = new ProofCommand(deps as never);

  const files = options.files ?? [file("ticket-1.png"), file("ticket-2.png")];
  const optionFiles: Record<string, FileOption | undefined> = {
    file: files[0],
    file_2: files[1],
    file_3: files[2],
  };
  const interaction = {
    guildId: GUILD,
    user: { id: MOD },
    attachmentSizeLimit: 10 * MB,
    inCachedGuild: () => true,
    options: {
      getString: (name: string) =>
        name === "case"
          ? (options.caseOption ?? "4822")
          : options.text === undefined
            ? "Same scam DMs sent to two more members"
            : options.text,
      getAttachment: (name: string) => optionFiles[name] ?? null,
    },
    reply: mock(async (_o: unknown) => undefined),
    deferReply: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
    deleteReply: mock(async () => undefined),
    followUp: mock(async (_o: unknown) => undefined),
  };

  return {
    run: () =>
      command.handler(interaction as unknown as ChatInputCommandInteraction),
    interaction,
    add,
  };
}

function payloadJson(call: unknown[] | undefined): string {
  const [payload] = (call ?? []) as [{ components: { toJSON(): unknown }[] }];
  return JSON.stringify(payload.components.map((c) => c.toJSON()));
}

function flagsOf(call: unknown[] | undefined): number {
  return ((call ?? [])[0] as { flags: number }).flags;
}

describe("/proof", () => {
  test("adds the text and files and replies publicly", async () => {
    const ctx = setup({});
    await ctx.run();

    expect(ctx.interaction.deferReply).toHaveBeenCalledWith();
    expect(ctx.add).toHaveBeenCalledWith({
      guildId: GUILD,
      caseIds: ["4822"],
      authorId: MOD,
      kind: "command",
      content: "Same scam DMs sent to two more members",
      files: [
        {
          url: file("ticket-1.png").url,
          name: "ticket-1.png",
          size: MB,
          contentType: "image/png",
        },
        {
          url: file("ticket-2.png").url,
          name: "ticket-2.png",
          size: MB,
          contentType: "image/png",
        },
      ],
      uploadLimit: 10 * MB,
    });

    const call = ctx.interaction.editReply.mock.calls[0];
    const out = payloadJson(call);
    expect(flagsOf(call) & MessageFlags.Ephemeral).toBe(0);
    expect(out).toContain(
      `✅ **Added proof to case #4822** · ${botEmoji("ban")} Ban · <@${TARGET}>`,
    );
    expect(out).toContain(
      "-# Saved 2 files and your note · mod log entry updated",
    );
    expect(out).toContain("Open mod log entry");
    expect(out).toContain(
      `https://discord.com/channels/${GUILD}/${MOD_LOG_CHANNEL}/1029384756102938499`,
    );
    expect(out).toContain("Same scam DMs sent to two more members");
    expect(out).toContain('"type":12');
    expect(out).toContain("ticket-2.png");
    expect(
      (
        ctx.interaction.editReply.mock.calls[0]?.[0] as {
          allowedMentions: unknown;
        }
      ).allowedMentions,
    ).toEqual({ parse: [] });
  });

  test("accepts #4822 and rejects ranges", () => {
    expect(parseProofCaseOption(" #4822 ")).toBe("4822");
    expect(parseProofCaseOption("4822-4830")).toBeNull();
    expect(parseProofCaseOption("spambot")).toBeNull();
  });

  test("without text or a file, refuses privately without deferring", async () => {
    const ctx = setup({ text: null, files: [] });
    await ctx.run();

    expect(ctx.interaction.deferReply).not.toHaveBeenCalled();
    expect(ctx.add).not.toHaveBeenCalled();
    const call = ctx.interaction.reply.mock.calls[0];
    expect(flagsOf(call) & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(payloadJson(call)).toContain(
      "**Add some proof first**\\n-# Fill in `text`, attach a `file`, or both.",
    );
  });

  const refusals: [string, Parameters<typeof setup>[0], string][] = [
    [
      "a case that isn't a number",
      { caseOption: "spambot" },
      "Pick a case from the list, or type its number.",
    ],
    ["a missing case", { cases: [] }, "There's no case #4822 in this server."],
    [
      "too many files",
      { existingFiles: 9 },
      "A case holds up to 10 proof files.",
    ],
    [
      "a file over the limit",
      { files: [file("big.mp4", 11 * MB)] },
      "The limit here is 10 MB.",
    ],
    [
      "files without a mod log channel",
      { modLogChannel: null },
      "this server has no mod log channel",
    ],
  ];

  for (const [name, options, text] of refusals) {
    test(`refuses ${name} privately and quotes the text back`, async () => {
      const ctx = setup(options);
      await ctx.run();

      expect(ctx.interaction.deferReply).not.toHaveBeenCalled();
      expect(ctx.add).not.toHaveBeenCalled();
      const call = ctx.interaction.reply.mock.calls[0];
      expect(flagsOf(call) & MessageFlags.Ephemeral).toBe(
        MessageFlags.Ephemeral,
      );
      const out = payloadJson(call);
      expect(out).toContain(text);
      expect(out).toContain("> Same scam DMs sent to two more members");
    });
  }

  test("a refusal after the defer replaces the public reply with a private one", async () => {
    const ctx = setup({
      result: Err({
        kind: "not_added",
        skipped: [{ caseId: "4822", reason: "retry_later" }],
      }),
    });
    await ctx.run();

    expect(ctx.interaction.deleteReply).toHaveBeenCalled();
    expect(ctx.interaction.editReply).not.toHaveBeenCalled();
    const call = ctx.interaction.followUp.mock.calls[0];
    expect(flagsOf(call) & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(payloadJson(call)).toContain(
      "The mod log entry is still being posted.",
    );
  });

  test("an unexpected failure is reported privately, not thrown to the router", async () => {
    const ctx = setup({ addThrows: true });
    await ctx.run();

    expect(ctx.interaction.deleteReply).toHaveBeenCalled();
    const [payload] = ctx.interaction.followUp.mock.calls[0] as [
      { flags: number },
    ];
    expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(payload)).toContain("Couldn't add proof");
  });
});

describe("/proof case autocomplete", () => {
  function autocomplete(options: {
    value: string;
    own?: ModerationCase[];
    matches?: ModerationCase[];
  }) {
    const searchCases = mock(
      async (_g: string, query: { kind: string }, _l: number) =>
        query.kind === "executor"
          ? (options.own ?? [])
          : (options.matches ?? []),
    );
    const findRecent = mock(async () => [makeCase({ caseId: "1" })]);
    const handler = new ProofCaseAutocomplete({
      modLogRepository: { searchCases, findRecent },
      logger: pino({ level: "silent" }),
      now: () => NOW,
    });
    const respond = mock(async (_c: unknown) => undefined);
    const interaction = {
      guildId: GUILD,
      user: { id: MOD },
      inCachedGuild: () => true,
      respond,
    };
    return {
      run: () =>
        handler.handler(interaction as unknown as AutocompleteInteraction, {
          name: "case",
          type: ApplicationCommandOptionType.String,
          value: options.value,
          focused: true,
        }),
      searchCases,
      findRecent,
      respond,
    };
  }

  test("empty input lists the mod's own newest cases", async () => {
    const ctx = autocomplete({ value: "", own: [makeCase()] });
    await ctx.run();

    expect(ctx.searchCases).toHaveBeenCalledWith(
      GUILD,
      { kind: "executor", executorId: MOD },
      25,
    );
    expect(ctx.findRecent).not.toHaveBeenCalled();
    expect(ctx.respond).toHaveBeenCalledWith([
      {
        name: "#4822 · Ban · spambot · 2 hours ago · Spamming invite links",
        value: "4822",
      },
    ]);
  });

  test("a mod without cases of their own gets the server's newest", async () => {
    const ctx = autocomplete({ value: "" });
    await ctx.run();

    expect(ctx.findRecent).toHaveBeenCalledWith(GUILD, 25);
  });

  test("typed text searches by case number or username", async () => {
    const ctx = autocomplete({ value: "#48", matches: [makeCase()] });
    await ctx.run();

    expect(ctx.searchCases).toHaveBeenCalledWith(
      GUILD,
      { kind: "text", text: "48" },
      25,
    );
  });
});

describe("formatProofCaseChoice", () => {
  test("fits 100 characters with the reason clipped last", () => {
    const name = formatProofCaseChoice(
      makeCase({ reason: `Spamming ${"invite links ".repeat(20)}` }),
      NOW,
    );

    expect(name.length).toBeLessThanOrEqual(100);
    expect(
      name.startsWith("#4822 · Ban · spambot · 2 hours ago · Spamming"),
    ).toBe(true);
    expect(name.endsWith("…")).toBe(true);
  });

  test("leaves the reason out when there is none", () => {
    expect(formatProofCaseChoice(makeCase({ reason: null }), NOW)).toBe(
      "#4822 · Ban · spambot · 2 hours ago",
    );
  });

  test("a very long username still fits", () => {
    const name = formatProofCaseChoice(
      makeCase({ userTag: "x".repeat(120) }),
      NOW,
    );
    expect(name.length).toBeLessThanOrEqual(100);
  });
});
