import { DiscordAPIError } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ActionResponseRegistry } from "@/features/moderation/actions/presentation/response/responseRegistry";
import type {
  ModLogMessageService,
  ModLogRefreshOutcome,
} from "@/features/moderation/shared/application/ModLogMessageService";
import type { ProofChangeListener } from "@/features/moderation/shared/application/ProofChangeListener";
import {
  type ProofFileSource,
  downloadProofSource,
  proofFileMaxBytes,
} from "@/features/moderation/shared/application/proofDownloads";
import type { ProofUpload } from "@/features/moderation/shared/application/proofHosting";
import {
  type CaseProof,
  type NewCaseProof,
  PROOF_CONTENT_MAX_LENGTH,
  PROOF_FILES_PER_CASE_MAX,
} from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type {
  ModerationMetrics,
  ProofAddOutcome,
  ProofUndoOutcome,
} from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import type { ProductEventTracker } from "@/features/product-analytics/domain/ProductEvent";

export type { ProofFileSource } from "@/features/moderation/shared/application/proofDownloads";

/** Where a mod added the proof from. */
export type ProofAddKind = "button" | "command" | "context_menu";

export interface AddProofInput {
  guildId: string;
  caseIds: string[];
  authorId: string;
  kind: ProofAddKind;
  content: string | null;
  files: ProofFileSource[];
  /** The message the proof was taken from (right-click); no author for a forward. */
  source?: { url: string; authorId: string | null; content: string | null };
  /** What the bot may upload in this guild, e.g. `interaction.attachmentSizeLimit`. */
  uploadLimit: number;
  /** A response that shows the new proof itself, so it isn't marked stale. */
  exceptMessageId?: string;
  /**
   * A retry of a refused add, without the files. The first attempt already
   * recorded the outcome, so this one records none.
   */
  fallback?: boolean;
}

/**
 * - `retry_later`: a mod log entry is still being posted
 * - `no_mod_log_for_files`: files need a mod log entry and there's none
 * - `failed`: Discord or the database failed for this case; others went ahead
 */
export type CaseSkipReason = "retry_later" | "no_mod_log_for_files" | "failed";

export interface CaseSkip {
  caseId: string;
  reason: CaseSkipReason;
}

/** Refused before anything was uploaded. */
export type AddProofRefusal =
  | "empty"
  | "content_too_long"
  | "too_many_files"
  | "file_too_large"
  | "cases_not_found";

/** No case got the proof; every case and why. */
export interface ProofNotAdded {
  kind: "not_added";
  skipped: CaseSkip[];
}

export type AddProofError = AddProofRefusal | ProofNotAdded;

export interface UndoProofInput {
  guildId: string;
  caseId: string;
  proofId: string;
  actorId: string;
}

export type UndoProofError = Exclude<ProofUndoOutcome, "ok">;

/** One proof row, its content already formatted by the caller. */
export interface SuggestionProofItem {
  content: string;
}

export interface AddSuggestionsInput {
  guildId: string;
  caseId: string;
  authorId: string;
  items: SuggestionProofItem[];
  /** A response that shows the new proof itself, so it isn't marked stale. */
  exceptMessageId?: string;
}

/**
 * Whether the stored rows are confirmed on the mod log: `pending` when the
 * entry was still being posted after a short wait, so they may show once it
 * lands; `not_shown` when some or all of them couldn't be placed.
 */
export type SuggestionPlacement = "all" | "pending" | "not_shown";

export interface AddSuggestionsResult {
  batchId: string;
  proofs: CaseProof[];
  case: ModerationCase;
  shown: SuggestionPlacement;
}

/** `retry_later` and `failed` are never returned yet: link-only rows don't wait on the entry. */
export type AddSuggestionsError =
  | "empty"
  | "content_too_long"
  | "case_not_found"
  | "retry_later"
  | "failed";

export interface UndoBatchInput {
  guildId: string;
  caseId: string;
  batchId: string;
  actorId: string;
}

/** `failed`: removal stopped at a row it couldn't confirm; earlier rows are gone. */
export type UndoBatchError =
  | { kind: "gone" }
  | { kind: "not_allowed" }
  | { kind: "failed"; removed: number; remaining: number };

export interface AddProofResult {
  /** The inserted rows, one per case that got the proof. */
  proofs: CaseProof[];
  /** Cases as loaded before adding, in the order given. */
  cases: ModerationCase[];
  /** Cases left without the proof when others got it. */
  skipped: CaseSkip[];
}

function placementOutcome(shown: SuggestionPlacement): ProofAddOutcome {
  switch (shown) {
    case "all":
      return "ok";
    case "pending":
      return "entry_pending";
    case "not_shown":
      return "not_shown";
  }
}

function errorOutcome(error: AddProofError): ProofAddOutcome {
  if (typeof error === "string") {
    return error;
  }
  const reasons = new Set(error.skipped.map((s) => s.reason));
  const [only] = reasons;
  return reasons.size === 1 ? only : "not_added";
}

export interface CaseProofServiceDeps {
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  caseProofRepository: Pick<
    CaseProofRepository,
    "add" | "countsByCases" | "findById" | "listByBatch"
  >;
  modLogMessageService: Pick<
    ModLogMessageService,
    "hostProof" | "removeProof" | "placeUnhostedText"
  >;
  responseRegistry: Pick<ActionResponseRegistry, "markStale">;
  proofChangeListener: ProofChangeListener;
  metrics: Pick<ModerationMetrics, "recordProofAdded" | "recordProofUndone">;
  productEvents?: ProductEventTracker;
  logger: Logger;
  download?: typeof downloadProofSource;
}

/**
 * Adds one proof entry to cases: the files go on each case's own mod log
 * entry (or a reply to it), then the row is stored with where they landed.
 */
export class CaseProofService {
  private readonly download: typeof downloadProofSource;

  constructor(private readonly deps: CaseProofServiceDeps) {
    this.download = deps.download ?? downloadProofSource;
  }

  async add(
    input: AddProofInput,
  ): Promise<Result<AddProofResult, AddProofError>> {
    let outcome: ProofAddOutcome = "failed";
    try {
      const result = await this.addProof(input);
      if (result.ok) {
        outcome = result.val.skipped.length > 0 ? "partial" : "ok";
      } else {
        outcome = errorOutcome(result.val);
      }
      return result;
    } finally {
      if (!input.fallback) {
        this.deps.metrics.recordProofAdded(input.kind, outcome);
        this.deps.productEvents?.track({
          name: "proof.added",
          userId: input.authorId,
          guildId: input.guildId,
          props: { source: input.kind, outcome },
        });
      }
    }
  }

  /** Undoes the actor's own Add as proof, removing its hosted files too. */
  async undo(
    input: UndoProofInput,
  ): Promise<Result<ModerationCase, UndoProofError>> {
    let outcome: ProofUndoOutcome = "failed";
    try {
      const result = await this.undoProof(input);
      outcome = result.ok ? "ok" : result.val;
      return result;
    } finally {
      this.deps.metrics.recordProofUndone(outcome);
    }
  }

  /** Stores the items as one batch of link-only proof rows on a single case. */
  async addSuggestions(
    input: AddSuggestionsInput,
  ): Promise<Result<AddSuggestionsResult, AddSuggestionsError>> {
    let outcome: ProofAddOutcome = "failed";
    try {
      const result = await this.addSuggestionBatch(input);
      if (result.ok) {
        outcome = placementOutcome(result.val.shown);
      } else {
        outcome =
          result.val === "case_not_found" ? "cases_not_found" : result.val;
      }
      return result;
    } finally {
      this.deps.metrics.recordProofAdded("suggestion", outcome);
      this.deps.productEvents?.track({
        name: "proof.added",
        userId: input.authorId,
        guildId: input.guildId,
        props: { source: "suggestion", outcome },
      });
    }
  }

  /** Undoes the actor's own suggestion batch. Ok only when every row is gone. */
  async undoBatch(
    input: UndoBatchInput,
  ): Promise<Result<ModerationCase, UndoBatchError>> {
    let outcome: ProofUndoOutcome = "failed";
    try {
      const result = await this.undoSuggestionBatch(input);
      outcome = result.ok ? "ok" : result.val.kind;
      return result;
    } finally {
      this.deps.metrics.recordProofUndone(outcome);
    }
  }

  private async addSuggestionBatch(
    input: AddSuggestionsInput,
  ): Promise<Result<AddSuggestionsResult, AddSuggestionsError>> {
    const contents = input.items.map((item) => item.content.trim());
    if (contents.length === 0 || contents.some((c) => c === "")) {
      return Err("empty");
    }
    if (contents.some((c) => c.length > PROOF_CONTENT_MAX_LENGTH)) {
      return Err("content_too_long");
    }

    const cases = await this.loadCases(input.guildId, [input.caseId]);
    const moderationCase = cases?.[0];
    if (!moderationCase) {
      return Err("case_not_found");
    }

    const batchId = crypto.randomUUID();
    const proofs = await this.deps.caseProofRepository.add(
      contents.map(
        (content): NewCaseProof => ({
          guildId: input.guildId,
          caseId: input.caseId,
          authorId: input.authorId,
          content,
          attachments: [],
          sourceMessageUrl: null,
          sourceAuthorId: null,
          sourceContent: null,
          hostMessageId: null,
          source: "suggestion",
          batchId,
        }),
      ),
    );

    const shown = await this.placeOnEntry(moderationCase);
    await this.deps.responseRegistry.markStale(input.guildId, [input.caseId], {
      exceptMessageId: input.exceptMessageId,
    });
    this.notifyProofChanged(input.guildId, [input.caseId]);

    this.deps.logger.info(
      {
        guildId: input.guildId,
        caseId: input.caseId,
        batchId,
        count: proofs.length,
        shown,
      },
      "Added suggested case proof",
    );

    return Ok({ batchId, proofs, case: moderationCase, shown });
  }

  /** The rows are already stored, so a Discord failure here can't fail the add. */
  private async placeOnEntry(
    moderationCase: ModerationCase,
  ): Promise<SuggestionPlacement> {
    const context = {
      guildId: moderationCase.guildId,
      caseId: moderationCase.caseId,
    };
    let placed: ModLogRefreshOutcome;
    try {
      placed =
        await this.deps.modLogMessageService.placeUnhostedText(moderationCase);
    } catch (err) {
      // Rows are stored, so the add stays Ok; non-Discord errors still need the error alert.
      if (err instanceof DiscordAPIError) {
        this.deps.logger.warn(
          { err, ...context },
          "Failed to show suggested proof on the mod log entry",
        );
      } else {
        this.deps.logger.error(
          { err, ...context },
          "Failed to show suggested proof on the mod log entry",
        );
      }
      return "not_shown";
    }

    if (placed === "updated") {
      return "all";
    }
    if (placed === "pending") {
      return "pending";
    }
    this.deps.logger.warn(
      { ...context, placed },
      "Suggested proof saved but not shown on the mod log",
    );
    return "not_shown";
  }

  private async undoSuggestionBatch(
    input: UndoBatchInput,
  ): Promise<Result<ModerationCase, UndoBatchError>> {
    const { guildId, caseId, batchId, actorId } = input;
    const rows = await this.deps.caseProofRepository.listByBatch(
      guildId,
      caseId,
      batchId,
    );
    if (rows.length === 0) {
      return Err({ kind: "gone" });
    }
    if (
      rows.some(
        (row) => row.source !== "suggestion" || row.authorId !== actorId,
      )
    ) {
      return Err({ kind: "not_allowed" });
    }

    const cases = await this.loadCases(guildId, [caseId]);
    const moderationCase = cases?.[0];
    if (!moderationCase) {
      return Err({ kind: "gone" });
    }

    let removed = 0;
    let alreadyGone = 0;
    let failedAt: number | null = null;
    try {
      for (const [index, row] of rows.entries()) {
        const result = await this.deps.modLogMessageService.removeProof(
          moderationCase,
          row.id,
        );
        if (result === "failed") {
          failedAt = index;
          this.deps.logger.warn(
            { guildId, caseId, batchId, proofId: row.id, removed },
            "Stopped undoing suggested proof at a row it couldn't remove",
          );
          break;
        }
        if (result === "removed") {
          removed++;
        } else {
          alreadyGone++;
        }
      }
    } catch (err) {
      if (removed > 0) {
        await this.afterProofRemoved(guildId, caseId).catch(
          (notifyErr: unknown) => {
            this.deps.logger.warn(
              { err: notifyErr, guildId, caseId, batchId },
              "Failed to mark responses stale after a failed undo",
            );
          },
        );
      }
      throw err;
    }
    if (removed > 0) {
      await this.afterProofRemoved(guildId, caseId);
    }

    if (failedAt !== null) {
      return Err({
        kind: "failed",
        removed,
        remaining: rows.length - failedAt,
      });
    }
    if (removed === 0) {
      return Err({ kind: "gone" });
    }

    this.deps.logger.info(
      { guildId, caseId, batchId, removed, alreadyGone },
      "Undid suggested case proof",
    );
    return Ok(moderationCase);
  }

  private async afterProofRemoved(
    guildId: string,
    caseId: string,
  ): Promise<void> {
    await this.deps.responseRegistry.markStale(guildId, [caseId]);
    this.notifyProofChanged(guildId, [caseId]);
  }

  private async undoProof(
    input: UndoProofInput,
  ): Promise<Result<ModerationCase, UndoProofError>> {
    const { guildId, caseId, proofId, actorId } = input;
    const proof = await this.deps.caseProofRepository.findById(
      guildId,
      proofId,
    );
    if (!proof || proof.caseId !== caseId) {
      return Err("gone");
    }
    if (proof.source !== "context_menu" || proof.authorId !== actorId) {
      return Err("not_allowed");
    }

    const cases = await this.loadCases(guildId, [caseId]);
    const moderationCase = cases?.[0];
    if (!moderationCase) {
      return Err("gone");
    }

    const removed = await this.deps.modLogMessageService.removeProof(
      moderationCase,
      proofId,
    );
    if (removed === "failed") {
      return Err("failed");
    }
    if (removed === "already_removed") {
      return Err("gone");
    }

    await this.deps.responseRegistry.markStale(guildId, [caseId]);
    this.notifyProofChanged(guildId, [caseId]);
    this.deps.logger.info({ guildId, caseId, proofId }, "Undid case proof");
    return Ok(moderationCase);
  }

  private async addProof(
    input: AddProofInput,
  ): Promise<Result<AddProofResult, AddProofError>> {
    const content = input.content?.trim() || null;
    if (!content && input.files.length === 0 && !input.source) {
      return Err("empty");
    }
    if (content && content.length > PROOF_CONTENT_MAX_LENGTH) {
      return Err("content_too_long");
    }

    const caseIds = [...new Set(input.caseIds)];
    const cases = await this.loadCases(input.guildId, caseIds);
    if (!cases) {
      return Err("cases_not_found");
    }

    if (input.files.length > 0) {
      const counts = await this.deps.caseProofRepository.countsByCases(
        input.guildId,
        caseIds,
      );
      const most = Math.max(
        0,
        ...caseIds.map((id) => counts.get(id)?.files ?? 0),
      );
      if (most + input.files.length > PROOF_FILES_PER_CASE_MAX) {
        return Err("too_many_files");
      }
    }

    const uploads = await this.downloadAll(input);
    if (!uploads.ok) {
      return uploads;
    }

    const proofs: CaseProof[] = [];
    const skipped: CaseSkip[] = [];
    const failures: { caseId: string; err: unknown }[] = [];
    for (const moderationCase of cases) {
      const draft: NewCaseProof = {
        guildId: input.guildId,
        caseId: moderationCase.caseId,
        authorId: input.authorId,
        content,
        attachments: [],
        sourceMessageUrl: input.source?.url ?? null,
        sourceAuthorId: input.source?.authorId ?? null,
        sourceContent: input.source?.content ?? null,
        hostMessageId: null,
        source: input.kind,
      };

      try {
        const added = await this.addToCase(moderationCase, draft, uploads.val);
        if (typeof added === "string") {
          skipped.push({ caseId: moderationCase.caseId, reason: added });
        } else {
          proofs.push(added);
        }
      } catch (err) {
        // Isolated so a failure on one case doesn't strand the rows already added.
        failures.push({ caseId: moderationCase.caseId, err });
        skipped.push({ caseId: moderationCase.caseId, reason: "failed" });
      }
    }

    const [firstFailure, ...otherFailures] = failures;
    if (proofs.length === 0 && firstFailure) {
      // The first is thrown to the caller; the rest are only seen here.
      this.logFailures(input.guildId, otherFailures);
      throw firstFailure.err;
    }
    this.logFailures(input.guildId, failures);
    if (proofs.length === 0) {
      return Err({ kind: "not_added", skipped });
    }

    await this.deps.responseRegistry.markStale(
      input.guildId,
      proofs.map((p) => p.caseId),
      { exceptMessageId: input.exceptMessageId },
    );
    this.notifyProofChanged(
      input.guildId,
      proofs.map((p) => p.caseId),
    );

    this.deps.logger.info(
      {
        guildId: input.guildId,
        caseIds: proofs.map((p) => p.caseId),
        skipped,
        kind: input.kind,
        files: uploads.val.length,
      },
      "Added case proof",
    );

    return Ok({ proofs, cases, skipped });
  }

  /**
   * Hosts the files on the case's entry, then stores the row with where they
   * landed. Discord failures throw before the row is stored.
   */
  private async addToCase(
    moderationCase: ModerationCase,
    draft: NewCaseProof,
    uploads: ProofUpload[],
  ): Promise<CaseProof | Exclude<CaseSkipReason, "failed">> {
    const hosted = await this.deps.modLogMessageService.hostProof(
      moderationCase,
      draft,
      uploads,
    );
    if (hosted.kind === "retry_later") {
      return "retry_later";
    }
    if (hosted.kind === "no_mod_log") {
      return "no_mod_log_for_files";
    }

    const [row] = await this.deps.caseProofRepository.add([
      {
        ...draft,
        attachments: hosted.kind === "hosted" ? hosted.attachmentUrls : [],
        hostMessageId: hosted.hostMessageId,
      },
    ]);
    return row;
  }

  private notifyProofChanged(guildId: string, caseIds: string[]): void {
    try {
      this.deps.proofChangeListener.proofChanged(guildId, caseIds);
    } catch (err) {
      // The proof is already stored, so a failed refresh can't fail the add.
      this.deps.logger.error(
        { err, guildId, caseIds },
        "Failed to notify proof change listener",
      );
    }
  }

  private logFailures(
    guildId: string,
    failures: readonly { caseId: string; err: unknown }[],
  ): void {
    for (const failure of failures) {
      this.deps.logger.error(
        { err: failure.err, guildId, caseId: failure.caseId },
        "Failed to add proof to a case",
      );
    }
  }

  /** null when any case is gone. */
  private async loadCases(
    guildId: string,
    caseIds: string[],
  ): Promise<ModerationCase[] | null> {
    const found = await this.deps.modLogRepository.findByIds(guildId, caseIds);
    const byId = new Map(found.map((c) => [c.caseId, c]));
    const cases = caseIds.flatMap((id) => byId.get(id) ?? []);
    return cases.length === caseIds.length ? cases : null;
  }

  /** Downloaded once and uploaded to every case. Failed downloads throw. */
  private async downloadAll(
    input: AddProofInput,
  ): Promise<Result<ProofUpload[], "file_too_large">> {
    const maxBytes = proofFileMaxBytes(input.uploadLimit);
    const uploads: ProofUpload[] = [];
    for (const file of input.files) {
      const download = await this.download(file, maxBytes);
      if (download.kind === "too_large") {
        return Err("file_too_large");
      }
      if (download.kind !== "ok") {
        throw new Error("Failed to download proof file", {
          cause: { guildId: input.guildId, download, name: file.name },
        });
      }
      uploads.push(download.file);
    }
    return Ok(uploads);
  }
}
