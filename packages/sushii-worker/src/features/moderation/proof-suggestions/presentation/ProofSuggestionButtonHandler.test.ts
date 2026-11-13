import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";

import {
  GUILD,
  MOD,
  OTHER_MOD,
  makeAllEmojis,
  makeCase,
  makeTarget,
  makeUser,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import {
  buildActionResultMessage,
  withSuggestionBlock,
} from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import { BanAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { ProofSuggestion } from "../domain/ProofSuggestion";
import { NOOP_PROOF_SUGGESTION_METRICS } from "../domain/ProofSuggestionMetrics";
import { fingerprintSuggestions } from "../domain/fingerprint";
import type { ResolvedSuggestionLinks } from "../domain/proofContent";
import { PreviewRendererBusyError } from "../infrastructure/preview/CanvasPreviewRenderer";
import { ProofSuggestionButtonHandler } from "./ProofSuggestionButtonHandler";
import { SuggestionFlow } from "./SuggestionFlow";
import {
  buildAddAllId,
  buildAddSelectedId,
  buildReviewId,
  buildUndoId,
} from "./customIds";
import {
  OUT_OF_DATE_TEXT,
  SUGGESTIONS_CHANGED_TEXT,
  SUGGESTIONS_DIFFER_TEXT,
  UNDO_UNAVAILABLE_TEXT,
  orderSuggestions,
} from "./suggestionText";
import {
  automodSuggestion,
  deletedSuggestion,
  recentSuggestion,
} from "./testFixtures";
import {
  buildAddedMessage,
  buildPicker,
  buildResponseSuggestionBlock,
  buildSuggestionAddResult,
} from "./views";

const BATCH = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const SUGGESTIONS = orderSuggestions([
  deletedSuggestion(),
  automodSuggestion(),
  recentSuggestion(),
]);
const FP = fingerprintSuggestions(SUGGESTIONS);

function resolvedFor(s: ProofSuggestion): ResolvedSuggestionLinks {
  return {
    links: s.messageIds.slice(0, 1).map((id) => ({
      url: `https://discord.com/channels/${GUILD}/${s.channelId}/${id}`,
      source: "message" as const,
      channelId: s.channelId,
      messageIds: [id],
    })),
    pending: [],
    skipped: [],
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function asMessage(message: { components: { toJSON(): unknown }[] }) {
  const components = message.components.map((c) => {
    const data = c.toJSON();
    return { toJSON: () => data };
  });
  return { id: "900000000000000000", createdTimestamp: Date.now(), components };
}

function setup(options: {
  customId: string;
  suggestions?: ProofSuggestion[];
  render?: (
    index: number,
  ) => Promise<{ png: Buffer; width: number; height: number }>;
  clicker?: string;
  message?: ReturnType<typeof asMessage>;
  undo?: Awaited<
    ReturnType<SuggestionFlow["deps"]["caseProofService"]["undoBatch"]>
  >;
}) {
  const moderationCase = makeCase();
  const shown: string[] = [];
  const added: string[] = [];
  let renders = 0;

  const findWithAccess = mock(async () => options.suggestions ?? SUGGESTIONS);
  const resolveLinksMany = mock(async (chosen: ProofSuggestion[]) =>
    chosen.map(resolvedFor),
  );
  const addSuggestions = mock(async () =>
    Ok({
      batchId: BATCH,
      proofs: [],
      case: moderationCase,
      shown: "all" as const,
    }),
  );
  const undoBatch = mock(async () => options.undo ?? Ok(moderationCase));
  const render = mock(async () => {
    const index = renders++;
    return options.render
      ? options.render(index)
      : { png: Buffer.from([index]), width: 1, height: 1 };
  });

  const flow = new SuggestionFlow({
    caseProofRepository: { listByCase: async () => [] },
    suggestions: {
      findWithAccess,
      resolveLinksMany,
      toPreviewRequestWithAccess: mock(async () => ({}) as never),
    },
    renderer: { render },
    caseProofService: { addSuggestions, undoBatch } as never,
    modLogRepository: { findByIds: mock(async () => [moderationCase]) },
    metrics: {
      ...NOOP_PROOF_SUGGESTION_METRICS,
      recordShown: (s) => shown.push(s),
      recordAdded: (s, o) => added.push(`${s}:${o}`),
    },
    logger: pino({ level: "silent" }),
  });

  const response = {
    modLogRepository: { findByIds: mock(async () => [moderationCase]) },
    caseProofRepository: {
      listByCases: mock(async () => new Map()),
      countsByCases: mock(async () => new Map()),
      listByCase: mock(async () => []),
    },
    guildConfigRepository: {
      findByGuildId: mock(async () => ({
        loggingSettings: { modLogChannel: null },
      })),
    },
    emojiRepository: { getEmojis: mock(async () => ({})) },
  };

  const handler = new ProofSuggestionButtonHandler({
    flow,
    response: response as never,
  });

  const interaction = {
    customId: options.customId,
    guildId: GUILD,
    user: { id: options.clicker ?? MOD },
    member: {
      id: options.clicker ?? MOD,
      guild: { channels: { resolve: () => ({ name: "general" }) } },
    },
    message: options.message ?? {
      id: "900000000000000000",
      createdTimestamp: Date.now(),
      components: [],
    },
    inCachedGuild: () => true,
    memberPermissions: { any: () => true },
    reply: mock(async (_o: unknown) => undefined),
    deferReply: mock(async (_o: unknown) => undefined),
    deferUpdate: mock(async () => undefined),
    editReply: mock(async (_o: unknown) => undefined),
    followUp: mock(async (_o: unknown) => undefined),
  };

  return {
    run: () =>
      handler.handleInteraction(interaction as unknown as ButtonInteraction),
    interaction,
    findWithAccess,
    resolveLinksMany,
    addSuggestions,
    undoBatch,
    render,
    shown,
    added,
    flow,
  };
}

function responseMessage() {
  const moderationCase = makeCase();
  const message = buildActionResultMessage({
    actionType: ActionType.Ban,
    executor: makeUser(MOD, "moderator"),
    targets: [makeTarget(moderationCase.userId, moderationCase.userTag)],
    results: [Ok(moderationCase)],
    guildConfig: GuildConfig.createDefault(GUILD),
    action: new BanAction(
      GUILD,
      makeUser(MOD, "moderator"),
      null,
      Reason.create("Spam").unwrap(),
      "unspecified",
    ),
    emojis: makeAllEmojis(),
    proofs: [],
    now: new Date(),
  });
  return asMessage(
    withSuggestionBlock(
      message.components.map((c) => c.toJSON()),
      buildResponseSuggestionBlock({
        caseId: "4822",
        fingerprint: FP,
        suggestions: SUGGESTIONS,
        targetName: moderationCase.userTag,
        actionType: ActionType.Ban,
      }),
    ) ?? message,
  );
}

describe("refresh after Add all", () => {
  for (const remaining of [
    [],
    [
      recentSuggestion({
        messageIds: ["999"],
        snippet: "PRIVATE MESSAGE TEXT",
        totalInWindow: 1,
      }),
    ],
  ]) {
    test(
      remaining.length === 0
        ? "all added removes the block"
        : "pending suggestions rebuild only what remains",
      async () => {
        const ctx = setup({
          customId: buildAddAllId("4822", FP),
          message: responseMessage(),
          clicker: OTHER_MOD,
        });
        ctx.findWithAccess
          .mockResolvedValueOnce(SUGGESTIONS)
          .mockResolvedValueOnce(remaining);
        await ctx.run();
        const response = json(ctx.interaction.editReply.mock.calls[0][0]);
        expect(ctx.findWithAccess).toHaveBeenCalledTimes(2);
        expect(response).not.toContain("Add all 3");
        expect(response).not.toContain("PRIVATE MESSAGE TEXT");
        expect(response).not.toContain("attachment://");
        if (remaining.length === 0) {
          expect(response).not.toContain("proof/suggest/");
        } else {
          expect(response).toContain("Add all 1");
          expect(response).toContain(
            buildAddAllId("4822", fingerprintSuggestions(remaining)),
          );
          expect(response).not.toContain("AutoMod alert");
        }
      },
    );
  }
});

describe("already saved selections", () => {
  for (const savedVia of ["message", "log"] as const) {
    for (const remainder of ["none", "pending", "skipped", "added"] as const) {
      test(`${savedVia} link with ${remainder} reports the complete outcome`, async () => {
        const ctx = setup({ customId: buildAddAllId("4822", FP) });
        const savedSuggestion = recentSuggestion({ messageIds: ["111"] });
        const other = recentSuggestion({ messageIds: ["222"] });
        const savedUrl = `https://discord.com/channels/${GUILD}/${savedSuggestion.channelId}/${savedVia === "log" ? "333" : "111"}`;
        ctx.flow.deps.caseProofRepository.listByCase = async () => [
          { source: "suggestion", content: `label · ${savedUrl}` } as CaseProof,
        ];
        ctx.resolveLinksMany.mockImplementation(async (chosen) =>
          chosen.map((s) => {
            if (s.messageIds[0] === "111") {
              return {
                links: [
                  {
                    url: savedUrl,
                    source: "log",
                    channelId: s.channelId,
                    messageIds: ["111"],
                  },
                ],
                pending: [],
                skipped: [],
              };
            }
            if (remainder === "pending") {
              return { links: [], pending: ["222"], skipped: [] };
            }
            if (remainder === "skipped") {
              return {
                links: [],
                pending: [],
                skipped: [{ messageId: "222", reason: "unchecked" }],
              };
            }
            return resolvedFor(s);
          }),
        );
        const result = await ctx.flow.add({
          moderationCase: makeCase(),
          chosen:
            remainder === "none" ? [savedSuggestion] : [savedSuggestion, other],
          authorId: MOD,
          surface: "review",
        });
        const text = json(buildSuggestionAddResult(result));
        if (remainder === "none") {
          expect(result.kind).toBe("already_added");
          expect(ctx.added).toEqual(["review:already_added"]);
        } else {
          expect(result.kind).toBe(
            remainder === "added" ? "added" : "nothing_linked",
          );
          expect(text).toContain("-# 1 already added.");
          expect(text).toContain(
            remainder === "pending"
              ? "still being logged"
              : remainder === "skipped"
                ? "couldn't check"
                : "Added **1 suggestion**",
          );
        }
      });
    }
  }
});

function pickerMessage(selected: number[]) {
  return asMessage(
    buildPicker(
      {
        caseId: "4822",
        fingerprint: FP,
        targetId: "912345678901234567",
        targetName: "spambot",
        actionType: ActionType.Ban,
        items: SUGGESTIONS.map((suggestion) => ({
          suggestion,
          channelName: "general",
          image: null,
        })),
        addOtherProofId: "caseProof/add/4822",
      },
      new Set(selected),
    ),
  );
}

describe("ProofSuggestionButtonHandler", () => {
  test.each([
    ["proof/suggest/add/4822/nothex!!", OUT_OF_DATE_TEXT],
    ["proof/suggest/undo/4822/not-a-uuid", UNDO_UNAVAILABLE_TEXT],
    ["proof/suggest/undo/abc/" + BATCH, UNDO_UNAVAILABLE_TEXT],
  ])("garbled id %s", async (customId, text) => {
    const ctx = setup({ customId });
    await ctx.run();

    const reply = ctx.interaction.reply.mock.calls[0][0] as { flags: number };
    expect(json(reply)).toContain(text);
    expect(reply.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(ctx.undoBatch).not.toHaveBeenCalled();
  });

  test("Review defers ephemeral and sends previews only there", async () => {
    const ctx = setup({ customId: buildReviewId("4822", FP) });
    await ctx.run();

    expect(ctx.interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    const picker = ctx.interaction.editReply.mock.calls[0][0] as {
      files: { name: string }[];
    };
    expect(picker.files.map((f) => f.name)).toEqual([
      "proof-0.png",
      "proof-1.png",
      "proof-2.png",
    ]);
    expect(ctx.shown).toEqual(["review"]);
  });

  test("mod log button counts as the modlog surface", async () => {
    const ctx = setup({ customId: buildReviewId("4822", null) });
    await ctx.run();
    expect(ctx.shown).toEqual(["modlog"]);
  });

  test("a busy or failing renderer leaves that suggestion as text only", async () => {
    const ctx = setup({
      customId: buildReviewId("4822", FP),
      render: async (index) => {
        if (index === 0) {
          throw new PreviewRendererBusyError();
        }
        if (index === 1) {
          throw new Error("canvas exploded");
        }
        return { png: Buffer.from([index]), width: 1, height: 1 };
      },
    });
    await ctx.run();

    const picker = ctx.interaction.editReply.mock.calls[0][0] as {
      files: unknown[];
    };
    expect(picker.files.length).toBe(1);
    expect(json(picker)).toContain("Pick suggestions");
    expect(json(picker)).not.toContain("canvas exploded");
  });

  test("Review with nothing to suggest shows Nothing left", async () => {
    const ctx = setup({
      customId: buildReviewId("4822", null),
      suggestions: [],
    });
    await ctx.run();

    expect(json(ctx.interaction.editReply.mock.calls[0][0])).toContain(
      "Nothing to suggest anymore.",
    );
    expect(ctx.render).not.toHaveBeenCalled();
  });

  test("Add all with a changed set saves nothing", async () => {
    const ctx = setup({
      customId: buildAddAllId("4822", "deadbeef"),
    });
    await ctx.run();

    expect(json(ctx.interaction.followUp.mock.calls[0][0])).toContain(
      SUGGESTIONS_CHANGED_TEXT,
    );
    expect(ctx.addSuggestions).not.toHaveBeenCalled();
    expect(ctx.added).toEqual(["response:changed"]);
  });

  test("another mod's click on Add all is told their set differs", async () => {
    const ctx = setup({
      customId: buildAddAllId("4822", "deadbeef"),
      clicker: OTHER_MOD,
    });
    await ctx.run();

    expect(json(ctx.interaction.followUp.mock.calls[0][0])).toContain(
      SUGGESTIONS_DIFFER_TEXT,
    );
    expect(ctx.addSuggestions).not.toHaveBeenCalled();
  });

  test("Add all resolves everything together and offers Undo", async () => {
    const ctx = setup({ customId: buildAddAllId("4822", FP) });
    await ctx.run();

    expect(ctx.interaction.deferUpdate).toHaveBeenCalled();
    expect(ctx.resolveLinksMany).toHaveBeenCalledTimes(1);
    expect(ctx.resolveLinksMany.mock.calls[0][0]).toHaveLength(3);
    expect(ctx.addSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "4822",
        authorId: MOD,
        exceptMessageId: "900000000000000000",
      }),
    );
    const added = ctx.interaction.followUp.mock.calls[0][0] as {
      flags: number;
    };
    expect(json(added)).toContain(
      "✅ Added **3 suggestions** (3 links) to **Case #4822**",
    );
    expect(json(added)).toContain(buildUndoId("4822", BATCH));
    expect(added.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(ctx.added).toEqual(["response:ok"]);
  });

  test("Add N adds the picked suggestions and replaces the picker", async () => {
    const ctx = setup({
      customId: buildAddSelectedId("4822", FP),
      message: pickerMessage([2]),
    });
    await ctx.run();

    expect(ctx.resolveLinksMany.mock.calls[0][0]).toEqual([SUGGESTIONS[2]]);
    const edit = ctx.interaction.editReply.mock.calls[0][0] as {
      attachments: unknown[];
    };
    expect(edit.attachments).toEqual([]);
    expect(json(edit)).toContain("Added **1 suggestion**");
    expect(ctx.added).toEqual(["review:ok"]);
  });

  test("Add N with nothing picked answers without deferring", async () => {
    const ctx = setup({
      customId: buildAddSelectedId("4822", FP),
      message: pickerMessage([]),
    });
    await ctx.run();

    expect(ctx.interaction.deferUpdate).not.toHaveBeenCalled();
    expect(json(ctx.interaction.reply.mock.calls[0][0])).toContain(
      "Pick at least one suggestion first.",
    );
  });

  describe("Undo", () => {
    const addedMessage = asMessage(
      buildAddedMessage(
        "✅ Added **2 suggestions** (5 links) to **Case #4822**",
        {
          caseId: "4822",
          batchId: BATCH,
        },
      ),
    );

    test("reports the links it removed", async () => {
      const ctx = setup({
        customId: buildUndoId("4822", BATCH),
        message: addedMessage,
      });
      await ctx.run();

      expect(ctx.undoBatch).toHaveBeenCalledWith({
        guildId: GUILD,
        caseId: "4822",
        batchId: BATCH,
        actorId: MOD,
      });
      const edit = json(ctx.interaction.editReply.mock.calls[0][0]);
      expect(edit).toContain("Undone. Removed 5 links from Case #4822.");
      expect(edit).not.toContain("proof/suggest/undo/");
    });

    test.each([
      [Err({ kind: "gone" as const }), "Already removed.", false],
      [
        Err({ kind: "failed" as const, removed: 1, remaining: 2 }),
        "Removed 1 of 3 links; 2 couldn't be removed. Try again.",
        true,
      ],
    ])("reports %p honestly", async (undo, text, keepsButton) => {
      const ctx = setup({
        customId: buildUndoId("4822", BATCH),
        message: addedMessage,
        undo,
      });
      await ctx.run();

      const edit = json(ctx.interaction.editReply.mock.calls[0][0]);
      expect(edit).toContain(text);
      expect(edit.includes("proof/suggest/undo/")).toBe(keepsButton);
    });

    test("refuses another mod's batch", async () => {
      const ctx = setup({
        customId: buildUndoId("4822", BATCH),
        message: addedMessage,
        undo: Err({ kind: "not_allowed" as const }),
      });
      await ctx.run();

      expect(json(ctx.interaction.followUp.mock.calls[0][0])).toContain(
        "Only the mod who added these can undo them.",
      );
    });
  });
});
