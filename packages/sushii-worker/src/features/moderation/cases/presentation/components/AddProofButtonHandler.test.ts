import { describe, expect, mock, spyOn, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import {
  GUILD,
  MOD,
  TARGET,
  makeAllEmojis,
  makeCase,
  makeTarget,
  makeUser,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import { buildActionResultMessage } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import { buildCaseViewMessages } from "@/features/moderation/mod-view/presentation/views/CaseView";
import type { ProofSuggestion } from "@/features/moderation/proof-suggestions/domain/ProofSuggestion";
import { NOOP_PROOF_SUGGESTION_METRICS } from "@/features/moderation/proof-suggestions/domain/ProofSuggestionMetrics";
import { fingerprintSuggestions } from "@/features/moderation/proof-suggestions/domain/fingerprint";
import { SuggestionFlow } from "@/features/moderation/proof-suggestions/presentation/SuggestionFlow";
import { orderSuggestions } from "@/features/moderation/proof-suggestions/presentation/suggestionText";
import {
  deletedSuggestion,
  recentSuggestion,
} from "@/features/moderation/proof-suggestions/presentation/testFixtures";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import { BanAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import {
  ADD_PROOF_FILES_ID,
  ADD_PROOF_TEXT_ID,
  readAddProofFields,
} from "@/features/moderation/shared/presentation/proof/addProofModal";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type {
  AddProofResult,
  CaseProofService,
} from "../../application/CaseProofService";
import { AddProofButtonHandler, addProofOrigin } from "./AddProofButtonHandler";

const ENTRY_ID = "1029384756102938499";
const RESPONSE_ID = "900000000000000000";
const CREATED = Date.parse("2026-10-27T11:00:00.000Z");

function proof(overrides: Partial<CaseProof> = {}): CaseProof {
  return {
    id: "1",
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    createdAt: new Date(CREATED),
    content: "Reported in #reports",
    attachments: [],
    sourceMessageUrl: null,
    sourceAuthorId: null,
    sourceContent: null,
    hostMessageId: ENTRY_ID,
    source: "button",
    ...overrides,
  };
}

function asMessage(id: string, components: readonly { toJSON(): unknown }[]) {
  return {
    id,
    createdTimestamp: CREATED,
    components: components.map((c) => {
      const json = c.toJSON();
      return { toJSON: () => json };
    }),
  };
}

function responseMessage(cases: ModerationCase[] = [makeCase()]) {
  const message = buildActionResultMessage({
    actionType: ActionType.Ban,
    executor: makeUser(MOD, "tzuyu"),
    targets: cases.map((c) => makeTarget(c.userId, c.userTag)),
    results: cases.map((c) => Ok(c)),
    guildConfig: GuildConfig.createDefault(GUILD),
    action: new BanAction(
      GUILD,
      makeUser(MOD, "tzuyu"),
      null,
      Reason.create("Spamming invite links").unwrap(),
      "unspecified",
    ),
    emojis: makeAllEmojis(),
    now: new Date(CREATED),
  });
  return asMessage(RESPONSE_ID, message.components);
}

/** A response whose posted suggestion block was built from the view with this fingerprint. */
function responseMessageWithBlock(fingerprint: string) {
  const base = responseMessage();
  const addAll = {
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: "Add all 2",
        custom_id: `proof/suggest/add/4822/${fingerprint}`,
      },
    ],
  };
  return {
    ...base,
    components: [...base.components, { toJSON: () => addAll }],
  };
}

function caseViewMessage() {
  const [first] = buildCaseViewMessages(
    makeCase(),
    [],
    Object.fromEntries(HISTORY_ACTION_EMOJIS.map((n) => [n, ""])) as never,
    { serverDmTextIncluded: false },
  );
  return asMessage("700000000000000000", first.components);
}

function fields(values: {
  text?: string;
  files?: unknown[];
  suggested?: string[];
}) {
  const map = new Map<string, unknown>();
  if (values.text !== undefined) {
    map.set(ADD_PROOF_TEXT_ID, { type: ComponentType.TextInput });
  }
  if (values.files !== undefined) {
    map.set(ADD_PROOF_FILES_ID, { type: ComponentType.FileUpload });
  }
  if (values.suggested !== undefined) {
    map.set("suggested", { type: ComponentType.CheckboxGroup });
  }
  return {
    fields: map,
    getTextInputValue: () => values.text ?? "",
    getUploadedFiles: () =>
      new Map((values.files ?? []).map((f, i) => [`${i}`, f])),
    getCheckboxGroup: () => values.suggested ?? [],
  };
}

function setup(options: {
  message: ReturnType<typeof responseMessage>;
  existingFiles?: number;
  result?: Awaited<ReturnType<CaseProofService["add"]>>;
  submitted?: { text?: string; files?: unknown[]; suggested?: string[] };
  now?: number;
  suggestionFlow?: SuggestionFlow;
  /** Proof entries the case already has. */
  entries?: number;
}) {
  const cases = [makeCase()];
  const add = mock(
    async () =>
      options.result ??
      Ok<AddProofResult>({
        proofs: [proof()],
        cases,
        skipped: [],
      }),
  );
  const listByCases = mock(async () => new Map([["4822", [proof()]]]));
  const listByCase = mock(async () => [proof()]);
  const logger = pino({ level: "silent" });
  const deps = {
    modLogRepository: { findByIds: mock(async () => cases) },
    caseProofRepository: {
      countsByCases: mock(
        async () =>
          new Map([
            [
              "4822",
              {
                entries: options.entries ?? 1,
                files: options.existingFiles ?? 0,
              },
            ],
          ]),
      ),
      listByCases,
      listByCase,
    },
    guildConfigRepository: {
      findByGuildId: mock(async () => GuildConfig.createDefault(GUILD)),
    },
    caseProofService: { add },
    emojiRepository: { getEmojis: mock(async () => makeAllEmojis()) },
    promptOffer: { offer: mock(async () => undefined) },
    suggestionFlow: options.suggestionFlow,
    logger,
    now: () => options.now ?? CREATED + 60_000,
  };
  const member = {
    id: MOD,
    guild: { channels: { resolve: () => ({ name: "general" }) } },
  };
  const handler = new AddProofButtonHandler(deps as never);

  const submission = {
    customId: "",
    user: { id: MOD },
    member,
    guildId: GUILD,
    message: options.message,
    fields: fields(options.submitted ?? { text: "Reported in #reports" }),
    attachmentSizeLimit: 10 * 1024 * 1024,
    inCachedGuild: () => true,
    isFromMessage: () => true,
    deferUpdate: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
    followUp: mock(async (_o: unknown) => undefined),
  };
  const interaction = {
    id: "555",
    customId: "caseProof/add/4822",
    guildId: GUILD,
    user: { id: MOD },
    member,
    message: options.message,
    inCachedGuild: () => true,
    memberPermissions: { any: () => true },
    reply: mock(async () => undefined),
    showModal: mock(async (_m: unknown) => undefined),
    awaitModalSubmit: mock(async () => {
      submission.customId = "caseProof/form/555";
      return submission;
    }),
  };

  return {
    run: () =>
      handler.handleInteraction(interaction as unknown as ButtonInteraction),
    interaction,
    submission,
    add,
    listByCase,
    logger,
    offer: deps.promptOffer.offer,
  };
}

function modalJson(ctx: ReturnType<typeof setup>) {
  const [modal] = ctx.interaction.showModal.mock.calls[0] as [
    { toJSON(): unknown },
  ];
  return JSON.stringify(modal.toJSON());
}

describe("Add proof form", () => {
  test("offers the files the case still has room for", async () => {
    const ctx = setup({ message: responseMessage(), existingFiles: 3 });
    await ctx.run();

    const json = modalJson(ctx);
    expect(json).toContain("Add proof · Case #4822");
    expect(json).toContain("It's never sent to spambot.");
    expect(json).toContain("up to 7 more on this case");
    expect(json).toContain('"max_values":7');
    expect(json).toContain('"max_length":1000');
  });

  test("a full case gets no file field and says why", async () => {
    const ctx = setup({ message: responseMessage(), existingFiles: 10 });
    await ctx.run();

    const json = modalJson(ctx);
    expect(json).not.toContain(`"custom_id":"${ADD_PROOF_FILES_ID}"`);
    expect(json).toContain("already has 10 files");
  });

  test("reads a submission without the optional fields", () => {
    expect(readAddProofFields(fields({}) as never)).toEqual({
      content: null,
      files: [],
      suggested: [],
    });
    expect(
      readAddProofFields(
        fields({
          text: "  ",
          files: [
            {
              url: "https://cdn.discordapp.com/a.png",
              name: "a.png",
              size: 5,
              contentType: "image/png",
            },
          ],
        }) as never,
      ),
    ).toEqual({
      content: null,
      files: [
        {
          url: "https://cdn.discordapp.com/a.png",
          name: "a.png",
          size: 5,
          contentType: "image/png",
        },
      ],
      suggested: [],
    });
  });
});

describe("Add proof submit", () => {
  test("on the response: adds without staling it and re-renders its proof", async () => {
    const ctx = setup({ message: responseMessage() });
    await ctx.run();

    expect(ctx.submission.deferUpdate).toHaveBeenCalledTimes(1);
    expect(ctx.add).toHaveBeenCalledWith({
      guildId: GUILD,
      caseIds: ["4822"],
      authorId: MOD,
      kind: "button",
      content: "Reported in #reports",
      files: [],
      uploadLimit: 10 * 1024 * 1024,
      exceptMessageId: RESPONSE_ID,
    });
    const edited = JSON.stringify(ctx.submission.editReply.mock.calls[0]);
    expect(edited).toContain("Reported in #reports");
    expect(edited).not.toContain("None yet");
    expect(ctx.submission.followUp).not.toHaveBeenCalled();
    expect(ctx.offer).toHaveBeenCalledWith(ctx.submission, "proof_intro");
  });

  test("on an expired response the re-render stays expired", async () => {
    const ctx = setup({
      message: responseMessage(),
      now: CREATED + 20 * 60 * 1000,
    });
    await ctx.run();

    expect(JSON.stringify(ctx.submission.editReply.mock.calls[0])).toContain(
      "Buttons expired after 15 minutes",
    );
  });

  test("on the mod log entry: the hosting already edited it", async () => {
    const ctx = setup({
      message: asMessage(ENTRY_ID, responseMessage().components),
    });
    await ctx.run();

    expect((ctx.add.mock.calls[0] as unknown[])[0]).toMatchObject({
      exceptMessageId: undefined,
    });
    expect(ctx.submission.editReply).not.toHaveBeenCalled();
  });

  test("on the case view: rebuilds it with the new proof", async () => {
    const ctx = setup({ message: caseViewMessage() });
    await ctx.run();

    const [edit] = ctx.submission.editReply.mock.calls[0] as [
      { flags: number },
    ];
    expect(edit.flags & MessageFlags.Ephemeral).toBe(0);
    expect(JSON.stringify(edit)).toContain("Reported in #reports");
  });

  test("an expected refusal is told privately and changes nothing", async () => {
    const ctx = setup({
      message: responseMessage(),
      result: Err({
        kind: "not_added",
        skipped: [{ caseId: "4822", reason: "retry_later" }],
      }),
    });
    await ctx.run();

    expect(ctx.submission.editReply).not.toHaveBeenCalled();
    const [note] = ctx.submission.followUp.mock.calls[0] as [{ flags: number }];
    expect(note.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(note)).toContain(
      "The mod log entry is still being posted. Try again in a few seconds.",
    );
    expect(ctx.offer).not.toHaveBeenCalled();
  });

  test("files without a mod log entry: the typed text comes back", async () => {
    const ctx = setup({
      message: responseMessage(),
      result: Err({
        kind: "not_added",
        skipped: [{ caseId: "4822", reason: "no_mod_log_for_files" }],
      }),
    });
    await ctx.run();
    const note = JSON.stringify(ctx.submission.followUp.mock.calls[0]);
    expect(note).toContain(
      "this case doesn't have one. If the server has no mod log channel, set one in `/settings`.",
    );
    expect(note).toContain("Nothing was saved. What you typed:");
    expect(note).toContain("> Reported in #reports");
  });

  test("a file too large states the limit", async () => {
    const ctx = setup({
      message: responseMessage(),
      result: Err("file_too_large"),
    });
    await ctx.run();
    expect(JSON.stringify(ctx.submission.followUp.mock.calls[0])).toContain(
      "The limit here is 10 MB.",
    );
  });

  test("every case skipped names each reason", async () => {
    const ctx = setup({
      message: responseMessage(),
      result: Err({
        kind: "not_added",
        skipped: [
          { caseId: "4822", reason: "retry_later" },
          { caseId: "4823", reason: "no_mod_log_for_files" },
        ],
      }),
    });
    await ctx.run();
    const note = JSON.stringify(ctx.submission.followUp.mock.calls[0]);
    expect(note).toContain("still being posted");
    expect(note).toContain("this case doesn't have one");
  });

  test("an empty form", async () => {
    const ctx = setup({ message: responseMessage(), result: Err("empty") });
    await ctx.run();
    expect(JSON.stringify(ctx.submission.followUp.mock.calls[0])).toContain(
      "Add some proof first",
    );
  });

  test("cases left out of a multi-case add are named", async () => {
    const ctx = setup({
      message: responseMessage(),
      result: Ok({
        proofs: [proof()],
        cases: [makeCase()],
        skipped: [{ caseId: "4823", reason: "retry_later" }],
      }),
    });
    await ctx.run();
    expect(JSON.stringify(ctx.submission.followUp.mock.calls[0])).toContain(
      "Not added: Case #4823",
    );
  });

  test("an unexpected failure is told privately once and logged, not rethrown", async () => {
    const ctx = setup({ message: responseMessage() });
    const error = spyOn(ctx.logger, "error");
    ctx.add.mockImplementationOnce(async () => {
      throw new Error("Missing Access");
    });
    await ctx.run();
    expect(ctx.submission.followUp).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(ctx.submission.followUp.mock.calls[0])).toContain(
      "Couldn't add proof",
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(ctx.submission.followUp.mock.calls[0])).toContain(
      "> Reported in #reports",
    );
    expect(ctx.offer).not.toHaveBeenCalled();
  });

  test("a failed refresh only warns: the proof is saved", async () => {
    const ctx = setup({ message: responseMessage() });
    const error = spyOn(ctx.logger, "error");
    const warn = spyOn(ctx.logger, "warn");
    ctx.submission.editReply.mockImplementationOnce(async () => {
      throw new Error("Unknown Message");
    });
    await ctx.run();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(ctx.submission.followUp).not.toHaveBeenCalled();
  });

  test("a split case view edits only its first message and points to the rest", async () => {
    const ctx = setup({ message: caseViewMessage() });
    ctx.listByCase.mockImplementation(async () =>
      Array.from({ length: 6 }, (_, i) =>
        proof({ id: `${i}`, content: `${i}`.repeat(1000) }),
      ),
    );
    await ctx.run();

    expect(ctx.submission.editReply).toHaveBeenCalledTimes(1);
    expect(ctx.submission.followUp).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.submission.editReply.mock.calls[0])).toContain(
      "Reopen the case view for the full proof",
    );
  });

  test("needs a mod permission", async () => {
    const ctx = setup({ message: responseMessage() });
    ctx.interaction.memberPermissions.any = () => false;
    await ctx.run();
    expect(ctx.interaction.showModal).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.interaction.reply.mock.calls[0])).toContain(
      "You need **Ban Members, Kick Members, or Timeout Members**",
    );
  });

  test("a dismissed form does nothing", async () => {
    const ctx = setup({ message: responseMessage() });
    ctx.interaction.awaitModalSubmit.mockImplementationOnce(async () => {
      throw new Error("time");
    });
    await ctx.run();
    expect(ctx.add).not.toHaveBeenCalled();
  });
});

describe("addProofOrigin", () => {
  test("the case's entry wins over the layout", () => {
    expect(
      addProofOrigin(asMessage(ENTRY_ID, responseMessage().components), [
        makeCase(),
      ]),
    ).toBe("mod_log");
    expect(addProofOrigin(responseMessage(), [makeCase()])).toBe("response");
    expect(addProofOrigin(caseViewMessage(), [makeCase()])).toBe("case_view");
    expect(
      addProofOrigin(asMessage("1", []), [makeCase({ userId: TARGET })]),
    ).toBe("other");
  });
});

function suggestionFlow(options: {
  proofSource?: "suggestion" | "button";
  computes?: ProofSuggestion[][];
}) {
  const computes = [...(options.computes ?? [SUGGESTED])];
  let last = computes[0] ?? [];
  const findWithAccess = mock(async () => {
    last = computes.shift() ?? last;
    return last;
  });
  const addSuggestions = mock(async () =>
    Ok({
      batchId: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
      proofs: [],
      case: makeCase(),
      shown: "all" as const,
    }),
  );
  const shown: string[] = [];
  const flow = new SuggestionFlow({
    caseProofRepository: {
      listByCase: async () =>
        options.proofSource
          ? [{ source: options.proofSource, content: null } as never]
          : [],
    },
    suggestions: {
      findWithAccess,
      resolveLinksMany: mock(async (chosen: ProofSuggestion[]) =>
        chosen.map((s) => ({
          links: [
            {
              url: `https://discord.com/channels/${GUILD}/${s.channelId}/${s.messageIds[0]}`,
              source: "message" as const,
              channelId: s.channelId,
              messageIds: [s.messageIds[0]],
            },
          ],
          pending: [],
          skipped: [],
        })),
      ),
      toPreviewRequestWithAccess: mock(async () => null),
    },
    renderer: { render: mock(async () => ({}) as never) },
    caseProofService: { addSuggestions, undoBatch: mock() } as never,
    modLogRepository: { findByIds: mock(async () => [makeCase()]) },
    metrics: {
      ...NOOP_PROOF_SUGGESTION_METRICS,
      recordShown: (s) => shown.push(s),
    },
    logger: pino({ level: "silent" }),
  });
  return { flow, findWithAccess, addSuggestions, shown };
}

const SUGGESTED = orderSuggestions([deletedSuggestion(), recentSuggestion()]);
const SUGGESTED_FP = fingerprintSuggestions(SUGGESTED);

describe("Add proof form with suggested proof", () => {
  test("still offers suggestions with suggestion-only proof", async () => {
    const s = suggestionFlow({ proofSource: "suggestion" });
    const ctx = setup({
      message: responseMessage(),
      suggestionFlow: s.flow,
      entries: 1,
    });
    await ctx.run();
    expect(modalJson(ctx)).toContain('"type":22');
  });
  test("lists suggestions as checkboxes above Details", async () => {
    const s = suggestionFlow({});
    const ctx = setup({
      message: responseMessage(),
      suggestionFlow: s.flow,
      entries: 0,
    });
    await ctx.run();

    const [modal] = ctx.interaction.showModal.mock.calls[0] as [
      { toJSON(): { custom_id: string } },
    ];
    expect(modal.toJSON().custom_id).toBe(`caseProof/form/555/${SUGGESTED_FP}`);
    const json = modalJson(ctx);
    expect(json).toContain('"type":22');
    expect(json).toContain("🗑️ 4 deleted messages · #general");
    expect(json.indexOf('"type":22')).toBeLessThan(
      json.indexOf('"custom_id":"text"'),
    );
    expect(s.shown).toEqual(["modal"]);
  });

  test("unchanged when the case has proof", async () => {
    const proven = suggestionFlow({ proofSource: "button" });
    const provenCtx = setup({
      message: responseMessage(),
      suggestionFlow: proven.flow,
      entries: 1,
    });
    await provenCtx.run();
    expect(modalJson(provenCtx)).not.toContain('"type":22');
    expect(proven.findWithAccess).not.toHaveBeenCalled();
  });

  test("ticked suggestions alone are a valid submit", async () => {
    const s = suggestionFlow({});
    const ctx = setup({
      message: responseMessage(),
      suggestionFlow: s.flow,
      entries: 0,
      submitted: { text: "", suggested: ["0"] },
    });
    await ctx.run();

    expect(ctx.add).not.toHaveBeenCalled();
    expect(s.addSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "4822",
        exceptMessageId: RESPONSE_ID,
      }),
    );
    expect(ctx.submission.editReply).toHaveBeenCalledTimes(1);
    const note = JSON.stringify(ctx.submission.followUp.mock.calls[0][0]);
    expect(note).toContain(
      "✅ Added **1 suggestion** (1 link) to **Case #4822**",
    );
    expect(note).toContain("proof/suggest/undo/4822/");
  });

  for (const remaining of [[], [recentSuggestion()]]) {
    test(`suggestion-only submit refreshes the response with ${remaining.length} remaining`, async () => {
      const s = suggestionFlow({ computes: [SUGGESTED, SUGGESTED, remaining] });
      const ctx = setup({
        message: responseMessageWithBlock(SUGGESTED_FP),
        suggestionFlow: s.flow,
        entries: 0,
        submitted: { text: "", suggested: ["0", "1"] },
      });
      await ctx.run();
      expect(s.findWithAccess).toHaveBeenCalledTimes(3);
      const response = JSON.stringify(
        ctx.submission.editReply.mock.calls[0][0],
      );
      if (remaining.length === 0) {
        expect(response).not.toContain("proof/suggest/");
      } else {
        expect(response).toContain("Add all 1");
        expect(response).toContain(fingerprintSuggestions(remaining));
      }
    });
  }

  test("a submit from a different view drops the public block instead of rebuilding it", async () => {
    const s = suggestionFlow({
      computes: [SUGGESTED, SUGGESTED, [recentSuggestion()]],
    });
    const ctx = setup({
      message: responseMessageWithBlock("ffffffff"),
      suggestionFlow: s.flow,
      entries: 0,
      submitted: { text: "", suggested: ["0", "1"] },
    });
    await ctx.run();

    const response = JSON.stringify(ctx.submission.editReply.mock.calls[0][0]);
    expect(response).not.toContain("proof/suggest/");
  });

  test("typed proof and ticked suggestions are both saved", async () => {
    const s = suggestionFlow({});
    const ctx = setup({
      message: responseMessage(),
      suggestionFlow: s.flow,
      entries: 0,
      submitted: { text: "Reported in #reports", suggested: ["0", "1"] },
    });
    await ctx.run();

    expect(ctx.add).toHaveBeenCalledTimes(1);
    expect(s.addSuggestions).toHaveBeenCalledTimes(1);
    expect(ctx.submission.editReply).toHaveBeenCalledTimes(1);
  });

  test("a changed set saves nothing and quotes the typed text back", async () => {
    const s = suggestionFlow({
      computes: [SUGGESTED, [deletedSuggestion()]],
    });
    const ctx = setup({
      message: responseMessage(),
      suggestionFlow: s.flow,
      entries: 0,
      submitted: { text: "Reported in #reports", suggested: ["0"] },
    });
    await ctx.run();

    expect(ctx.add).not.toHaveBeenCalled();
    expect(s.addSuggestions).not.toHaveBeenCalled();
    const note = JSON.stringify(ctx.submission.followUp.mock.calls[0][0]);
    expect(note).toContain(
      "The suggestions changed. Open Add proof again to see the current ones.",
    );
    expect(note).toContain("Reported in #reports");
  });
});
