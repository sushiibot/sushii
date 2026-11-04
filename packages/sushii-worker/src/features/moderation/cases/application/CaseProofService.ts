import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ActionResponseRegistry } from "@/features/moderation/actions/presentation/response/responseRegistry";
import type { ModLogMessageService } from "@/features/moderation/shared/application/ModLogMessageService";
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
} from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";

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
  /** The message the proof was taken from (right-click). */
  source?: { url: string; authorId: string; content: string | null };
  /** What the bot may upload in this guild, e.g. `interaction.attachmentSizeLimit`. */
  uploadLimit: number;
  /** A response that shows the new proof itself, so it isn't marked stale. */
  exceptMessageId?: string;
}

/**
 * - `retry_later`: a mod log entry is still being posted
 * - `no_mod_log_for_files`: files need a mod log entry and there's none
 */
export type CaseSkipReason = "retry_later" | "no_mod_log_for_files";

export type AddProofError =
  | "empty"
  | "content_too_long"
  | "too_many_files"
  | "file_too_large"
  | "cases_not_found"
  | CaseSkipReason;

export interface AddProofResult {
  /** The inserted rows, one per case that got the proof. */
  proofs: CaseProof[];
  /** Cases as loaded before adding, in the order given. */
  cases: ModerationCase[];
  /** Cases left without the proof when others got it. */
  skipped: { caseId: string; reason: CaseSkipReason }[];
}

export interface CaseProofServiceDeps {
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  caseProofRepository: Pick<CaseProofRepository, "add" | "countsByCases">;
  modLogMessageService: Pick<ModLogMessageService, "hostProof">;
  responseRegistry: Pick<ActionResponseRegistry, "markStale">;
  metrics: Pick<ModerationMetrics, "recordProofAdded">;
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
        outcome = result.val;
      }
      return result;
    } finally {
      this.deps.metrics.recordProofAdded(input.kind, outcome);
    }
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
    const skipped: AddProofResult["skipped"] = [];
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

      // Discord failures throw: the row is only stored once its files are on the entry.
      const hosted = await this.deps.modLogMessageService.hostProof(
        moderationCase,
        draft,
        uploads.val,
      );
      if (hosted.kind === "retry_later" || hosted.kind === "no_mod_log") {
        skipped.push({
          caseId: moderationCase.caseId,
          reason:
            hosted.kind === "retry_later"
              ? "retry_later"
              : "no_mod_log_for_files",
        });
        continue;
      }

      const [row] = await this.deps.caseProofRepository.add([
        {
          ...draft,
          attachments: hosted.kind === "hosted" ? hosted.attachmentUrls : [],
          hostMessageId: hosted.hostMessageId,
        },
      ]);
      proofs.push(row);
    }

    if (proofs.length === 0) {
      return Err(skipped[0].reason);
    }

    await this.deps.responseRegistry.markStale(
      input.guildId,
      proofs.map((p) => p.caseId),
      { exceptMessageId: input.exceptMessageId },
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
