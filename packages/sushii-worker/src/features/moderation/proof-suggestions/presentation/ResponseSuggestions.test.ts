import { describe, expect, mock, test } from "bun:test";
import pino from "pino";
import { Ok } from "ts-results";

import {
  GUILD,
  MOD,
  makeAllEmojis,
  makeCase,
  makeTarget,
  makeUser,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import {
  ACTION_RESPONSE_IDS,
  buildActionResultMessage,
  rebuildActionResponse,
} from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import { BanAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { ProofSuggestion } from "../domain/ProofSuggestion";
import { NOOP_PROOF_SUGGESTION_METRICS } from "../domain/ProofSuggestionMetrics";
import { ResponseSuggestions, purgeSettled } from "./ResponseSuggestions";
import { SuggestionFlow } from "./SuggestionFlow";
import { ACTION_TIME, deletedSuggestion, messageIdAt } from "./testFixtures";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function postedResponse(proofs: CaseProof[] = []) {
  const moderationCase = makeCase();
  const message = buildActionResultMessage({
    actionType: ActionType.Ban,
    executor: makeUser(MOD, "tzuyu"),
    targets: [makeTarget(moderationCase.userId, moderationCase.userTag)],
    results: [Ok(moderationCase)],
    guildConfig: GuildConfig.createDefault(GUILD),
    action: new BanAction(
      GUILD,
      makeUser(MOD, "tzuyu"),
      null,
      Reason.create("Spamming invite links").unwrap(),
      "unspecified",
    ),
    emojis: makeAllEmojis(),
    proofs,
    now: ACTION_TIME,
  });
  return message.components.map((c) => {
    const data = c.toJSON();
    return { toJSON: () => data };
  });
}

/** Messages in the purge window, not yet in the message log. */
function purging(): ProofSuggestion {
  return deletedSuggestion({ kind: "recent", deletedCount: 0 });
}

function setup(options: {
  flag?: boolean;
  computes?: (ProofSuggestion[] | Error)[];
  components?: ReturnType<typeof postedResponse>;
}) {
  const computes = [...(options.computes ?? [[deletedSuggestion()]])];
  let last: ProofSuggestion[] | Error = [];
  const findWithAccess = mock(async () => {
    last = computes.length > 0 ? (computes.shift() as never) : last;
    if (last instanceof Error) {
      throw last;
    }
    return last;
  });
  const shown: string[] = [];
  const recordShown = mock(
    (surface: string, actor: { userId: string; guildId: string }) => {
      expect(actor).toEqual({ userId: MOD, guildId: GUILD });
      shown.push(surface);
    },
  );
  const logger = pino({ level: "silent" });
  const error = mock(() => undefined);
  logger.error = error as never;

  const flow = new SuggestionFlow({
    caseProofRepository: { listByCase: async () => [] },
    flags: { isEnabled: mock(async () => options.flag ?? true) },
    suggestions: {
      findWithAccess,
      resolveLinksMany: mock(async () => []),
      toPreviewRequestWithAccess: mock(async () => null),
    },
    renderer: { render: mock(async () => ({}) as never) },
    caseProofService: {} as never,
    modLogRepository: { findByIds: mock(async () => []) },
    metrics: {
      ...NOOP_PROOF_SUGGESTION_METRICS,
      recordShown,
    },
    logger,
  });

  let clock = 0;
  const sleep = mock(async (ms: number) => {
    clock += ms;
  });
  const responseSuggestions = new ResponseSuggestions(flow, {
    sleep,
    now: () => clock,
  });

  const interaction = {
    user: { id: MOD },
    guildId: GUILD,
    member: { id: MOD, guild: { channels: { resolve: () => null } } },
    fetchReply: mock(async () => ({
      components: options.components ?? postedResponse(),
    })),
    editReply: mock(async (_o: unknown) => undefined),
  };

  return {
    attach: (purgeWindowSeconds: number | null = 0) =>
      responseSuggestions.attach({
        interaction: interaction as never,
        moderationCase: makeCase(),
        purgeWindowSeconds,
      }),
    interaction,
    findWithAccess,
    sleep,
    shown,
    error,
  };
}

describe("ResponseSuggestions", () => {
  test("adds the text-only block under the proof", async () => {
    const ctx = setup({});
    await ctx.attach();

    const edit = json(ctx.interaction.editReply.mock.calls[0][0]);
    expect(edit).toContain(
      "**💡 1 suggestion** · from spambot's last activity before the ban",
    );
    expect(edit).toContain(`"id":${ACTION_RESPONSE_IDS.suggestionsRow}`);
    expect(edit).not.toContain("secret deleted spam text");
    expect(
      edit.indexOf(`"id":${ACTION_RESPONSE_IDS.proofSection}`),
    ).toBeLessThan(edit.indexOf(`"id":${ACTION_RESPONSE_IDS.suggestions}`));
    expect(ctx.shown).toEqual(["response"]);
    expect(ctx.sleep).not.toHaveBeenCalled();
  });

  test("flag off leaves the response alone", async () => {
    const ctx = setup({ flag: false });
    await ctx.attach();
    expect(ctx.findWithAccess).not.toHaveBeenCalled();
    expect(ctx.interaction.editReply).not.toHaveBeenCalled();
  });

  test("no suggestions: no edit", async () => {
    const ctx = setup({ computes: [[]] });
    await ctx.attach();
    expect(ctx.interaction.fetchReply).not.toHaveBeenCalled();
    expect(ctx.interaction.editReply).not.toHaveBeenCalled();
  });

  test("never throws into the action", async () => {
    const ctx = setup({ computes: [new Error("db down")] });
    await ctx.attach();
    expect(ctx.interaction.editReply).not.toHaveBeenCalled();
    expect(ctx.error).toHaveBeenCalled();

    const failingEdit = setup({});
    failingEdit.interaction.editReply.mockImplementation(async () => {
      throw new Error("edit failed");
    });
    await failingEdit.attach();
  });

  test("skips a response that already shows proof", async () => {
    const proof: CaseProof = {
      id: "1",
      guildId: GUILD,
      caseId: "4822",
      authorId: MOD,
      createdAt: ACTION_TIME,
      content: "Reported in #reports",
      attachments: [],
      sourceMessageUrl: null,
      sourceAuthorId: null,
      sourceContent: null,
      hostMessageId: null,
      source: "button",
    };
    const ctx = setup({ components: postedResponse([proof]) });
    await ctx.attach();
    expect(ctx.interaction.editReply).not.toHaveBeenCalled();
  });

  test("waits for a purge to reach the message log before labelling", async () => {
    const ctx = setup({
      computes: [[purging()], [purging()], [deletedSuggestion()]],
    });
    await ctx.attach(3600);

    expect(ctx.sleep).toHaveBeenCalledTimes(2);
    expect(json(ctx.interaction.editReply.mock.calls[0][0])).toContain(
      "4 deleted messages",
    );
  });

  test("stops waiting after 5 seconds", async () => {
    const ctx = setup({ computes: [[purging()]] });
    await ctx.attach(3600);

    expect(ctx.sleep.mock.calls.reduce((n, [ms]) => n + ms, 0)).toBe(5_000);
    expect(json(ctx.interaction.editReply.mock.calls[0][0])).toContain(
      "still visible",
    );
  });

  test("a rebuild accepts an empty recomputed block after proof is added", async () => {
    const posted = postedResponse().map((c) => c.toJSON()) as never[];
    const withBlock = setup({});
    await withBlock.attach();
    {
      const edited = withBlock.interaction.editReply.mock.calls[0][0] as {
        components: { toJSON(): unknown }[];
      };
      const after = edited.components.map((c) => c.toJSON()) as never[];
      const body = {
        cases: [makeCase()],
        emojis: makeAllEmojis() as never,
        savePrompt: false,
        mode: "buttons" as const,
      };

      expect(
        json(rebuildActionResponse(after, { ...body, proofs: [] })),
      ).toContain(`"id":${ACTION_RESPONSE_IDS.suggestions}`);
      const expired = JSON.parse(
        json(
          rebuildActionResponse(after, {
            ...body,
            proofs: [],
            mode: "expired",
          }),
        ),
      ) as {
        components: {
          components: { id?: number; components?: { disabled?: boolean }[] }[];
        }[];
      };
      const row = expired.components[0].components.find(
        (c) => c.id === ACTION_RESPONSE_IDS.suggestionsRow,
      );
      expect(row?.components?.map((b) => b.disabled)).toEqual([true, true]);
      for (const source of ["suggestion", "button"] as const) {
        const rebuiltWithProof = json(
          rebuildActionResponse(after, {
            ...body,
            proofs: [
              {
                id: "1",
                guildId: GUILD,
                caseId: "4822",
                authorId: MOD,
                createdAt: ACTION_TIME,
                content: "x",
                attachments: [],
                sourceMessageUrl: null,
                sourceAuthorId: null,
                sourceContent: null,
                hostMessageId: null,
                source,
              },
            ],
            suggestions: [],
          }),
        );
        expect(
          rebuiltWithProof.includes(`"id":${ACTION_RESPONSE_IDS.suggestions}`),
        ).toBe(false);
      }
      expect(
        json(rebuildActionResponse(posted, { ...body, proofs: [] })),
      ).not.toContain(`"id":${ACTION_RESPONSE_IDS.suggestions}`);
    }
  });
});

describe("purgeSettled", () => {
  test("only messages inside the purge window need a log post", () => {
    const old = messageIdAt(120);
    const fresh = messageIdAt(1);
    const mixed = deletedSuggestion({
      kind: "recent",
      messageIds: [old, fresh],
      deletedCount: 1,
    });
    expect(purgeSettled([mixed], ACTION_TIME, 600)).toBe(true);
    expect(
      purgeSettled([{ ...mixed, deletedCount: 0 }], ACTION_TIME, 600),
    ).toBe(false);
    expect(purgeSettled([{ ...mixed, deletedCount: 0 }], ACTION_TIME, 30)).toBe(
      true,
    );
  });
});
