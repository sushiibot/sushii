import { describe, expect, mock, spyOn, test } from "bun:test";
import pino from "pino";

import {
  GUILD,
  MOD,
  makeCase,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import type {
  ModLogRefreshOutcome,
  ProofHostResult,
  ProofRemoveResult,
} from "@/features/moderation/shared/application/ModLogMessageService";
import type {
  CaseProof,
  NewCaseProof,
} from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";

import { type AddProofInput, CaseProofService } from "./CaseProofService";

const FILE = {
  url: "https://cdn.discordapp.com/ephemeral-attachments/1/2/shot.png?ex=a",
  name: "shot.png",
  size: 100,
  contentType: "image/png",
};

const HOSTED_URL = "https://cdn.discordapp.com/attachments/9/8/1_shot.png?ex=b";

const UNDO_PROOF: CaseProof = {
  id: "7",
  guildId: GUILD,
  caseId: "4822",
  authorId: MOD,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  content: null,
  attachments: [HOSTED_URL],
  sourceMessageUrl: null,
  sourceAuthorId: null,
  sourceContent: null,
  hostMessageId: "1029384756102938499",
  source: "context_menu",
};

function setup(
  options: {
    caseIds?: string[];
    existingFiles?: number;
    storedProof?: CaseProof | null;
    removed?: ProofRemoveResult;
    batch?: CaseProof[];
    host?: (caseId: string) => ProofHostResult;
    download?: Awaited<
      ReturnType<
        NonNullable<
          ConstructorParameters<typeof CaseProofService>[0]["download"]
        >
      >
    >;
  } = {},
) {
  const caseIds = options.caseIds ?? ["4822"];
  const findByIds = mock(async (_g: string, ids: string[]) =>
    ids
      .filter((id) => caseIds.includes(id))
      .map((id) => makeCase({ caseId: id })),
  );
  let nextId = 1;
  const add = mock(async (rows: NewCaseProof[]) =>
    rows.map(
      (row): CaseProof => ({
        ...row,
        id: String(nextId++),
        createdAt: new Date(),
      }),
    ),
  );
  const countsByCases = mock(
    async (_g: string, ids: string[]) =>
      new Map(
        ids.map((id) => [
          id,
          { entries: 1, files: options.existingFiles ?? 0 },
        ]),
      ),
  );
  const hostProof = mock(
    async (
      moderationCase: { caseId: string },
      _draft: NewCaseProof,
      files: unknown[],
    ): Promise<ProofHostResult> =>
      options.host
        ? options.host(moderationCase.caseId)
        : files.length > 0
          ? {
              kind: "hosted",
              hostMessageId: `msg-${moderationCase.caseId}`,
              attachmentUrls: [HOSTED_URL],
            }
          : {
              kind: "text_only",
              hostMessageId: `msg-${moderationCase.caseId}`,
            },
  );
  const markStale = mock(async (): Promise<void> => undefined);
  const proofChanged = mock(
    (_guildId: string, _caseIds: string[]) => undefined,
  );
  const recordProofAdded = mock();
  const recordProofUndone = mock();
  const findById = mock(
    async (_g: string, _id: string): Promise<CaseProof | null> =>
      options.storedProof === undefined ? UNDO_PROOF : options.storedProof,
  );
  const removeProof = mock(
    async (): Promise<ProofRemoveResult> => options.removed ?? "removed",
  );
  const listByBatch = mock(
    async (_g: string, _c: string, _b: string): Promise<CaseProof[]> =>
      options.batch ?? [],
  );
  const placeUnhostedText = mock(
    async (_case: ModerationCase): Promise<ModLogRefreshOutcome> => "updated",
  );
  const download = mock(
    async () =>
      options.download ?? {
        kind: "ok" as const,
        file: { name: "shot.png", data: Buffer.from([1]), contentType: null },
      },
  );

  const logger = pino({ level: "silent" });
  const service = new CaseProofService({
    modLogRepository: { findByIds },
    caseProofRepository: { add, countsByCases, findById, listByBatch },
    modLogMessageService: { hostProof, removeProof, placeUnhostedText },
    responseRegistry: { markStale },
    proofChangeListener: { proofChanged },
    metrics: { recordProofAdded, recordProofUndone },
    logger,
    download,
  });

  const input = (extra: Partial<AddProofInput> = {}): AddProofInput => ({
    guildId: GUILD,
    caseIds,
    authorId: MOD,
    kind: "button",
    content: "Reported in #reports",
    files: [],
    uploadLimit: 10 * 1024 * 1024,
    ...extra,
  });

  return {
    service,
    input,
    findByIds,
    add,
    hostProof,
    markStale,
    proofChanged,
    recordProofAdded,
    recordProofUndone,
    findById,
    removeProof,
    listByBatch,
    placeUnhostedText,
    download,
    logger,
  };
}

describe("CaseProofService validation", () => {
  test("a fallback retry records no second outcome", async () => {
    const ctx = setup();
    await ctx.service.add(ctx.input({ fallback: true }));
    expect(ctx.recordProofAdded).not.toHaveBeenCalled();
  });

  test("nothing to add", async () => {
    const ctx = setup();
    const result = await ctx.service.add(ctx.input({ content: "  " }));
    expect(result.val).toBe("empty");
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "empty");
    expect(ctx.hostProof).not.toHaveBeenCalled();
  });

  test("a bare source message is proof", async () => {
    const ctx = setup();
    const result = await ctx.service.add(
      ctx.input({
        content: null,
        kind: "context_menu",
        source: {
          url: "https://discord.com/channels/1/2/3",
          authorId: "5",
          content: null,
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("text over 1000 characters", async () => {
    const ctx = setup();
    const result = await ctx.service.add(
      ctx.input({ content: "a".repeat(1001) }),
    );
    expect(result.val).toBe("content_too_long");
  });

  test("a deleted case", async () => {
    const ctx = setup({ caseIds: ["4822"] });
    const result = await ctx.service.add(
      ctx.input({ caseIds: ["4822", "4823"] }),
    );
    expect(result.val).toBe("cases_not_found");
    expect(ctx.hostProof).not.toHaveBeenCalled();
  });

  test("more than 10 files on the case", async () => {
    const ctx = setup({ existingFiles: 9 });
    const result = await ctx.service.add(ctx.input({ files: [FILE, FILE] }));
    expect(result.val).toBe("too_many_files");
    expect(ctx.download).not.toHaveBeenCalled();
  });

  test("a file over the upload limit", async () => {
    const ctx = setup({ download: { kind: "too_large", bytes: 999 } });
    const result = await ctx.service.add(ctx.input({ files: [FILE] }));
    expect(result.val).toBe("file_too_large");
    expect(ctx.hostProof).not.toHaveBeenCalled();
  });

  test("a failed download throws without saving", async () => {
    const ctx = setup({ download: { kind: "transient", status: 500 } });
    await expect(ctx.service.add(ctx.input({ files: [FILE] }))).rejects.toThrow(
      "Failed to download proof file",
    );
    expect(ctx.add).not.toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "failed");
  });
});

describe("CaseProofService hosting", () => {
  test("hosts on the entry, stores the hosted URLs and marks responses stale", async () => {
    const ctx = setup();
    const result = await ctx.service.add(
      ctx.input({ files: [FILE], exceptMessageId: "777" }),
    );

    expect(result.ok).toBe(true);
    const [row] = ctx.add.mock.calls[0][0];
    expect(row).toMatchObject({
      caseId: "4822",
      authorId: MOD,
      content: "Reported in #reports",
      attachments: [HOSTED_URL],
      hostMessageId: "msg-4822",
      source: "button",
    });
    expect(ctx.markStale).toHaveBeenCalledWith(GUILD, ["4822"], {
      exceptMessageId: "777",
    });
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "ok");
  });

  test("multi-case hosts each case on its own entry, downloading once", async () => {
    const ctx = setup({ caseIds: ["4822", "4823"] });
    const result = await ctx.service.add(ctx.input({ files: [FILE] }));

    expect(ctx.download).toHaveBeenCalledTimes(1);
    expect(ctx.hostProof).toHaveBeenCalledTimes(2);
    expect(ctx.add.mock.calls.map((c) => c[0][0].hostMessageId)).toEqual([
      "msg-4822",
      "msg-4823",
    ]);
    expect(result.unwrap().proofs).toHaveLength(2);
  });

  test("text without a mod log entry is still saved", async () => {
    const ctx = setup({
      host: () => ({ kind: "text_only", hostMessageId: null }),
    });
    const result = await ctx.service.add(ctx.input());
    expect(result.ok).toBe(true);
    expect(ctx.add.mock.calls[0][0][0].hostMessageId).toBeNull();
  });

  test("files without a mod log channel", async () => {
    const ctx = setup({ host: () => ({ kind: "no_mod_log" }) });
    const result = await ctx.service.add(ctx.input({ files: [FILE] }));
    expect(result.val).toEqual({
      kind: "not_added",
      skipped: [{ caseId: "4822", reason: "no_mod_log_for_files" }],
    });
    expect(ctx.add).not.toHaveBeenCalled();
    expect(ctx.markStale).not.toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith(
      "button",
      "no_mod_log_for_files",
    );
  });

  test("an entry still being posted", async () => {
    const ctx = setup({ host: () => ({ kind: "retry_later" }) });
    const result = await ctx.service.add(ctx.input({ files: [FILE] }));
    expect(result.val).toEqual({
      kind: "not_added",
      skipped: [{ caseId: "4822", reason: "retry_later" }],
    });
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "retry_later");
  });

  test("every case skipped reports every case and reason", async () => {
    const ctx = setup({
      caseIds: ["4822", "4823"],
      host: (caseId) =>
        caseId === "4822" ? { kind: "retry_later" } : { kind: "no_mod_log" },
    });
    const result = await ctx.service.add(ctx.input({ files: [FILE] }));
    expect(result.val).toEqual({
      kind: "not_added",
      skipped: [
        { caseId: "4822", reason: "retry_later" },
        { caseId: "4823", reason: "no_mod_log_for_files" },
      ],
    });
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "not_added");
  });

  test("a failure partway keeps the cases already added", async () => {
    const ctx = setup({ caseIds: ["4822", "4823", "4824"] });
    ctx.hostProof.mockImplementation(async (moderationCase) => {
      if (moderationCase.caseId === "4823") {
        throw new Error("Missing Access");
      }
      return { kind: "text_only", hostMessageId: "m" };
    });
    const error = spyOn(ctx.logger, "error");

    const result = (await ctx.service.add(ctx.input())).unwrap();

    expect(result.proofs.map((p) => p.caseId)).toEqual(["4822", "4824"]);
    expect(result.skipped).toEqual([{ caseId: "4823", reason: "failed" }]);
    expect(ctx.markStale).toHaveBeenCalledWith(GUILD, ["4822", "4824"], {
      exceptMessageId: undefined,
    });
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "partial");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({ caseId: "4823" });
  });

  test("a failure on every case is rethrown", async () => {
    const ctx = setup({ caseIds: ["4822", "4823"] });
    const error = spyOn(ctx.logger, "error");
    ctx.hostProof.mockImplementation(async () => {
      throw new Error("Missing Access");
    });
    await expect(ctx.service.add(ctx.input())).rejects.toThrow(
      "Missing Access",
    );
    expect(ctx.markStale).not.toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "failed");
    // The first is rethrown for the caller to log; only the others are logged here.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({ caseId: "4823" });
  });

  test("a case still being posted is skipped while the others get it", async () => {
    const ctx = setup({
      caseIds: ["4822", "4823"],
      host: (caseId) =>
        caseId === "4823"
          ? { kind: "retry_later" }
          : { kind: "text_only", hostMessageId: "m" },
    });
    const result = (await ctx.service.add(ctx.input())).unwrap();
    expect(result.proofs.map((p) => p.caseId)).toEqual(["4822"]);
    expect(result.skipped).toEqual([{ caseId: "4823", reason: "retry_later" }]);
    expect(ctx.markStale).toHaveBeenCalledWith(GUILD, ["4822"], {
      exceptMessageId: undefined,
    });
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("button", "partial");
  });

  test("a Discord failure while hosting throws and saves nothing", async () => {
    const ctx = setup();
    ctx.hostProof.mockImplementationOnce(async () => {
      throw new Error("Missing Access");
    });
    await expect(ctx.service.add(ctx.input())).rejects.toThrow(
      "Missing Access",
    );
    expect(ctx.add).not.toHaveBeenCalled();
  });
});

describe("CaseProofService proof change listener", () => {
  test("is told only about the cases that got the proof", async () => {
    const ctx = setup({
      caseIds: ["4822", "4823", "4824"],
      host: (caseId) =>
        caseId === "4823"
          ? { kind: "retry_later" }
          : { kind: "text_only", hostMessageId: "m" },
    });

    await ctx.service.add(ctx.input());

    expect(ctx.proofChanged).toHaveBeenCalledTimes(1);
    expect(ctx.proofChanged).toHaveBeenCalledWith(GUILD, ["4822", "4824"]);
  });

  test("is not told when no case got the proof", async () => {
    const ctx = setup({ host: () => ({ kind: "retry_later" }) });

    const result = await ctx.service.add(ctx.input());

    expect(result.ok).toBe(false);
    expect(ctx.proofChanged).not.toHaveBeenCalled();
  });

  test("is not told about a refused add", async () => {
    const ctx = setup();

    await ctx.service.add(ctx.input({ content: null }));

    expect(ctx.proofChanged).not.toHaveBeenCalled();
  });

  test("a throwing listener doesn't fail the add", async () => {
    const ctx = setup();
    ctx.proofChanged.mockImplementation(() => {
      throw new Error("boom");
    });
    const error = spyOn(ctx.logger, "error");

    const result = await ctx.service.add(ctx.input());

    expect(result.ok).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({
      guildId: GUILD,
      caseIds: ["4822"],
    });
  });
});

describe("CaseProofService.undo", () => {
  const input = {
    guildId: GUILD,
    caseId: "4822",
    proofId: "7",
    actorId: MOD,
  };

  test("removes the proof, then refreshes everything showing it", async () => {
    const ctx = setup();

    const result = await ctx.service.undo(input);

    expect(result.ok).toBe(true);
    expect(ctx.removeProof).toHaveBeenCalledTimes(1);
    expect(ctx.markStale).toHaveBeenCalledWith(GUILD, ["4822"]);
    expect(ctx.proofChanged).toHaveBeenCalledWith(GUILD, ["4822"]);
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("ok");
  });

  test("a proof that's gone reports it", async () => {
    const ctx = setup({ storedProof: null });

    const result = await ctx.service.undo(input);

    expect(result.val).toBe("gone");
    expect(ctx.removeProof).not.toHaveBeenCalled();
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("gone");
  });

  test("a proof on another case is treated as gone", async () => {
    const ctx = setup();

    const result = await ctx.service.undo({ ...input, caseId: "4823" });

    expect(result.val).toBe("gone");
    expect(ctx.removeProof).not.toHaveBeenCalled();
  });

  test("another mod can't undo it", async () => {
    const ctx = setup();

    const result = await ctx.service.undo({ ...input, actorId: "1" });

    expect(result.val).toBe("not_allowed");
    expect(ctx.removeProof).not.toHaveBeenCalled();
  });

  test("proof added another way can't be undone here", async () => {
    const ctx = setup({ storedProof: { ...UNDO_PROOF, source: "button" } });

    const result = await ctx.service.undo(input);

    expect(result.val).toBe("not_allowed");
    expect(ctx.removeProof).not.toHaveBeenCalled();
  });

  test("a Discord failure leaves everything else alone", async () => {
    const ctx = setup({ removed: "failed" });

    const result = await ctx.service.undo(input);

    expect(result.val).toBe("failed");
    expect(ctx.markStale).not.toHaveBeenCalled();
    expect(ctx.proofChanged).not.toHaveBeenCalled();
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("failed");
  });

  test("an unexpected error is thrown and counted as failed", async () => {
    const ctx = setup();
    ctx.removeProof.mockImplementation(async () => {
      throw new Error("db down");
    });

    await expect(ctx.service.undo(input)).rejects.toThrow("db down");

    expect(ctx.recordProofUndone).toHaveBeenCalledWith("failed");
  });

  test("losing a race with another undo reports it as gone", async () => {
    const ctx = setup({ removed: "already_removed" });

    const result = await ctx.service.undo(input);

    expect(result.val).toBe("gone");
    expect(ctx.markStale).not.toHaveBeenCalled();
  });
});

describe("CaseProofService.addSuggestions", () => {
  const input = {
    guildId: GUILD,
    caseId: "4822",
    authorId: MOD,
    items: [
      {
        content: "🗑️ Deleted in #general · https://discord.com/channels/1/2/3",
      },
      { content: "🛡️ AutoMod alert · https://discord.com/channels/1/4/5" },
    ],
  };

  test("no items", async () => {
    const ctx = setup();
    const result = await ctx.service.addSuggestions({ ...input, items: [] });
    expect(result.val).toBe("empty");
    expect(ctx.add).not.toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("suggestion", "empty");
  });

  test("a blank item", async () => {
    const ctx = setup();
    const result = await ctx.service.addSuggestions({
      ...input,
      items: [...input.items, { content: "  " }],
    });
    expect(result.val).toBe("empty");
    expect(ctx.add).not.toHaveBeenCalled();
  });

  test("an item over 1000 characters", async () => {
    const ctx = setup();
    const result = await ctx.service.addSuggestions({
      ...input,
      items: [{ content: "a".repeat(1001) }],
    });
    expect(result.val).toBe("content_too_long");
    expect(ctx.add).not.toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith(
      "suggestion",
      "content_too_long",
    );
  });

  test("a missing case", async () => {
    const ctx = setup({ caseIds: [] });
    const result = await ctx.service.addSuggestions(input);
    expect(result.val).toBe("case_not_found");
    expect(ctx.add).not.toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith(
      "suggestion",
      "cases_not_found",
    );
  });

  test("stores one batch and places it on the entry once", async () => {
    const ctx = setup();
    const result = await ctx.service.addSuggestions({
      ...input,
      exceptMessageId: "77",
    });

    expect(result.ok).toBe(true);
    const { batchId, proofs, shown } = result.unwrap();
    expect(shown).toBe("all");
    expect(proofs).toHaveLength(2);
    expect(proofs.every((p) => p.batchId === batchId)).toBe(true);
    expect(proofs.every((p) => p.source === "suggestion")).toBe(true);
    expect(proofs.every((p) => p.attachments.length === 0)).toBe(true);
    expect(ctx.add).toHaveBeenCalledTimes(1);
    expect(ctx.hostProof).not.toHaveBeenCalled();
    expect(ctx.placeUnhostedText).toHaveBeenCalledTimes(1);
    expect(ctx.markStale).toHaveBeenCalledWith(GUILD, ["4822"], {
      exceptMessageId: "77",
    });
    expect(ctx.proofChanged).toHaveBeenCalledWith(GUILD, ["4822"]);
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("suggestion", "ok");
  });

  test("a placement that throws returns the batch as not shown", async () => {
    const ctx = setup();
    const error = spyOn(ctx.logger, "error");
    ctx.placeUnhostedText.mockImplementation(async () => {
      throw new Error("db down");
    });

    const result = await ctx.service.addSuggestions(input);

    expect(result.unwrap().shown).toBe("not_shown");
    expect(error).toHaveBeenCalledTimes(1);
    expect(ctx.markStale).toHaveBeenCalled();
    expect(ctx.recordProofAdded).toHaveBeenCalledWith(
      "suggestion",
      "not_shown",
    );
  });

  test.each([
    ["failed", "not_shown", "not_shown"],
    ["no_message", "not_shown", "not_shown"],
    ["not_configured", "not_shown", "not_shown"],
    ["pending", "pending", "entry_pending"],
  ] as const)("a %s placement returns %s", async (placed, shown, outcome) => {
    const ctx = setup();
    ctx.placeUnhostedText.mockImplementation(async () => placed);

    const result = await ctx.service.addSuggestions(input);

    expect(result.unwrap().shown).toBe(shown);
    expect(ctx.recordProofAdded).toHaveBeenCalledWith("suggestion", outcome);
  });
});

describe("CaseProofService.undoBatch", () => {
  const BATCH_ID = "0b6a5c1e-5f0e-4c3a-9a57-3c1f0b8f6d21";
  const batchRow = (id: string, extra: Partial<CaseProof> = {}): CaseProof => ({
    ...UNDO_PROOF,
    id,
    attachments: [],
    hostMessageId: null,
    content: "🗑️ Deleted · https://discord.com/channels/1/2/3",
    source: "suggestion",
    batchId: BATCH_ID,
    ...extra,
  });
  const input = {
    guildId: GUILD,
    caseId: "4822",
    batchId: BATCH_ID,
    actorId: MOD,
  };

  test("removes every row in the batch", async () => {
    const ctx = setup({ batch: [batchRow("1"), batchRow("2")] });

    const result = await ctx.service.undoBatch(input);

    expect(result.ok).toBe(true);
    expect(ctx.listByBatch).toHaveBeenCalledWith(GUILD, "4822", BATCH_ID);
    expect(ctx.removeProof).toHaveBeenCalledTimes(2);
    expect(ctx.markStale).toHaveBeenCalledTimes(1);
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("ok");
  });

  test("an empty batch is gone", async () => {
    const ctx = setup({ batch: [] });
    const result = await ctx.service.undoBatch(input);
    expect(result.val).toEqual({ kind: "gone" });
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("gone");
  });

  test("another mod's batch is refused", async () => {
    const ctx = setup({ batch: [batchRow("1"), batchRow("2")] });
    const result = await ctx.service.undoBatch({ ...input, actorId: "999" });
    expect(result.val).toEqual({ kind: "not_allowed" });
    expect(ctx.removeProof).not.toHaveBeenCalled();
  });

  test("a non-suggestion row in the batch refuses the whole undo", async () => {
    const ctx = setup({
      batch: [batchRow("1"), batchRow("2", { source: "button" })],
    });
    const result = await ctx.service.undoBatch(input);
    expect(result.val).toEqual({ kind: "not_allowed" });
    expect(ctx.removeProof).not.toHaveBeenCalled();
  });

  test("stops at the first row it can't remove and reports counts", async () => {
    const ctx = setup({
      batch: [batchRow("1"), batchRow("2"), batchRow("3")],
    });
    ctx.removeProof
      .mockImplementationOnce(async () => "removed")
      .mockImplementationOnce(async () => "failed");

    const result = await ctx.service.undoBatch(input);

    expect(result.val).toEqual({ kind: "failed", removed: 1, remaining: 2 });
    expect(ctx.removeProof).toHaveBeenCalledTimes(2);
    expect(ctx.markStale).toHaveBeenCalledTimes(1);
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("failed");
  });

  test("a removal that throws still marks what was removed stale", async () => {
    const ctx = setup({ batch: [batchRow("1"), batchRow("2")] });
    ctx.removeProof
      .mockImplementationOnce(async () => "removed")
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      });

    await expect(ctx.service.undoBatch(input)).rejects.toThrow("db down");
    expect(ctx.markStale).toHaveBeenCalledTimes(1);
    expect(ctx.proofChanged).toHaveBeenCalledWith(GUILD, ["4822"]);
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("failed");
  });

  test("a failing stale step doesn't hide the removal error", async () => {
    const ctx = setup({ batch: [batchRow("1"), batchRow("2")] });
    ctx.removeProof
      .mockImplementationOnce(async () => "removed")
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      });
    ctx.markStale.mockImplementation(async () => {
      throw new Error("registry down");
    });

    await expect(ctx.service.undoBatch(input)).rejects.toThrow("db down");
  });

  test("rows removed earlier with the rest removed now is ok", async () => {
    const ctx = setup({ batch: [batchRow("1"), batchRow("2")] });
    ctx.removeProof
      .mockImplementationOnce(async () => "already_removed")
      .mockImplementationOnce(async () => "removed");

    const result = await ctx.service.undoBatch(input);

    expect(result.ok).toBe(true);
    expect(ctx.markStale).toHaveBeenCalledTimes(1);
    expect(ctx.recordProofUndone).toHaveBeenCalledWith("ok");
  });

  test("rows all removed by someone else is gone", async () => {
    const ctx = setup({ batch: [batchRow("1")], removed: "already_removed" });
    const result = await ctx.service.undoBatch(input);
    expect(result.val).toEqual({ kind: "gone" });
    expect(ctx.markStale).not.toHaveBeenCalled();
  });
});
