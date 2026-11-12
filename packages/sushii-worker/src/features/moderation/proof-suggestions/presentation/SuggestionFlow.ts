import type { Logger } from "pino";

import type { FeatureFlagRepository } from "@/features/feature-flags/domain/FeatureFlagRepository";
import type { CaseProofService } from "@/features/moderation/cases/application/CaseProofService";
import { KeyedMutex } from "@/features/moderation/shared/application/KeyedMutex";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import type {
  ProofSuggestionService,
  ResolveLinksOptions,
} from "../application/ProofSuggestionService";
import type { ViewerAccess } from "../application/viewerAccess";
import type { ProofSuggestion } from "../domain/ProofSuggestion";
import type {
  ProofSuggestionMetrics,
  SuggestionAddOutcome,
  SuggestionSurface,
} from "../domain/ProofSuggestionMetrics";
import { fingerprintSuggestions } from "../domain/fingerprint";
import { messageUrl, toProofItems } from "../domain/proofContent";
import { PreviewRendererBusyError } from "../infrastructure/preview/types";
import type { SuggestionPreviewRenderer } from "../infrastructure/preview/types";
import { savedSuggestionLinks } from "./savedProof";
import {
  SUGGESTION_ACTIONS,
  orderSuggestions,
  summarize,
} from "./suggestionText";
import type { AddedSummary } from "./suggestionText";
import type { PickerItem } from "./views";

const RENDER_CONCURRENCY = 2;
/** Keeps a picker's uploads well under the smallest upload limit. */
const PREVIEW_BYTES_BUDGET = 8 * 1024 * 1024;

export type SuggestionAddResult =
  | { kind: "added"; batchId: string; summary: AddedSummary }
  | { kind: "nothing_linked"; summary: AddedSummary }
  | { kind: "case_not_found" }
  | { kind: "already_added" }
  | { kind: "failed" };

export interface SuggestionFlowDeps {
  caseProofRepository: Pick<CaseProofRepository, "listByCase">;
  flags: Pick<FeatureFlagRepository, "isEnabled">;
  suggestions: Pick<
    ProofSuggestionService,
    "findWithAccess" | "resolveLinksMany" | "toPreviewRequestWithAccess"
  >;
  renderer: SuggestionPreviewRenderer;
  caseProofService: Pick<CaseProofService, "addSuggestions" | "undoBatch">;
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  metrics: ProofSuggestionMetrics;
  logger: Logger;
}

/** What every suggested proof surface shares: who sees what, previews and adding. */
export class SuggestionFlow {
  private readonly adds = new KeyedMutex();
  constructor(readonly deps: SuggestionFlowDeps) {}

  get metrics(): ProofSuggestionMetrics {
    return this.deps.metrics;
  }

  enabled(guildId: string): Promise<boolean> {
    return this.deps.flags.isEnabled(guildId, "proof_suggestions");
  }

  eligible(moderationCase: ModerationCase): boolean {
    return SUGGESTION_ACTIONS.has(moderationCase.actionType);
  }

  async loadCase(
    guildId: string,
    caseId: string,
  ): Promise<ModerationCase | null> {
    const [found] = await this.deps.modLogRepository.findByIds(guildId, [
      caseId,
    ]);
    return found ?? null;
  }

  /** In the order every surface indexes into. */
  async compute(
    moderationCase: ModerationCase,
    access: ViewerAccess,
    includeSaved = false,
  ): Promise<ProofSuggestion[]> {
    if (!this.eligible(moderationCase)) {
      return [];
    }
    const proofs = await this.deps.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    );
    if (proofs.some((proof) => proof.source !== "suggestion")) {
      return [];
    }
    const found = await this.deps.suggestions.findWithAccess(
      {
        guildId: moderationCase.guildId,
        targetId: moderationCase.userId,
        actionTime: moderationCase.actionTime,
        savedMessageLinks: includeSaved ? [] : savedSuggestionLinks(proofs),
      },
      access,
    );
    return orderSuggestions(found);
  }

  fingerprint(suggestions: readonly ProofSuggestion[]): string {
    return fingerprintSuggestions([...suggestions]);
  }

  /**
   * Sushii stores the purge window only for softbans, so a ban case can't
   * tell a `/ban` without deletes from a native ban; treat it as unknown.
   */
  resolveOptions(moderationCase: ModerationCase): ResolveLinksOptions {
    const base = {
      guildId: moderationCase.guildId,
      actionKind: moderationCase.actionType,
      actionTime: moderationCase.actionTime,
    };
    switch (moderationCase.actionType) {
      case ActionType.Ban:
      case ActionType.TempBan:
      case ActionType.Softban:
        return moderationCase.deleteMessageSeconds !== null
          ? { ...base, purgeWindowSeconds: moderationCase.deleteMessageSeconds }
          : { ...base, purgeWindowUnknown: true };
      default:
        return base;
    }
  }

  /** Previews for the clicker's own suggestions; any that fail show as text only. */
  async renderItems(
    moderationCase: ModerationCase,
    suggestions: readonly ProofSuggestion[],
    access: ViewerAccess,
  ): Promise<PickerItem[]> {
    const items: PickerItem[] = suggestions.map((suggestion) => ({
      suggestion,
      channelName: access.channelName(
        suggestion.kind === "automod" && suggestion.blockedInChannelId
          ? suggestion.blockedInChannelId
          : suggestion.channelId,
      ),
      image: null,
    }));

    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        items[index].image = await this.renderOne(
          moderationCase,
          items[index].suggestion,
          access,
          index,
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(RENDER_CONCURRENCY, items.length) },
        worker,
      ),
    );

    let bytes = 0;
    for (const item of items) {
      if (!item.image) {
        continue;
      }
      bytes += item.image.png.length;
      if (bytes > PREVIEW_BYTES_BUDGET) {
        item.image = null;
      }
    }
    return items;
  }

  private async renderOne(
    moderationCase: ModerationCase,
    suggestion: ProofSuggestion,
    access: ViewerAccess,
    index: number,
  ): Promise<PickerItem["image"]> {
    const context = {
      guildId: moderationCase.guildId,
      caseId: moderationCase.caseId,
      kind: suggestion.kind,
    };
    try {
      const request = await this.deps.suggestions.toPreviewRequestWithAccess(
        suggestion,
        {
          guildId: moderationCase.guildId,
          targetId: moderationCase.userId,
          targetDisplayName: moderationCase.userTag,
        },
        access,
      );
      if (!request) {
        return null;
      }
      const started = performance.now();
      const { png } = await this.deps.renderer.render(request);
      this.deps.metrics.recordRenderMs(performance.now() - started);
      return { name: `proof-${index}.png`, png };
    } catch (err) {
      // Previews only help a mod decide; the suggestion still shows as text.
      if (err instanceof PreviewRendererBusyError) {
        this.deps.logger.debug(context, "Preview renderer busy");
      } else {
        this.deps.logger.warn(
          { err, ...context },
          "Failed to render a suggested proof preview",
        );
      }
      return null;
    }
  }

  /** Resolves the chosen suggestions together, then stores them as one undoable batch. */
  async add(input: {
    moderationCase: ModerationCase;
    chosen: readonly ProofSuggestion[];
    authorId: string;
    surface: SuggestionSurface;
    exceptMessageId?: string;
  }): Promise<SuggestionAddResult> {
    return this.adds.run(
      `${input.moderationCase.guildId}:${input.moderationCase.caseId}`,
      () => this.addLocked(input),
    );
  }

  private async addLocked(
    input: Parameters<SuggestionFlow["add"]>[0],
  ): Promise<SuggestionAddResult> {
    const { moderationCase } = input;
    const { metrics } = this.deps;
    let outcome: SuggestionAddOutcome = "failed";
    let links = 0;
    try {
      const proofs = await this.deps.caseProofRepository.listByCase(
        moderationCase.guildId,
        moderationCase.caseId,
      );
      const saved = new Set(savedSuggestionLinks(proofs));
      const alreadyAdded = new Set<string>();
      const chosen = input.chosen
        .map((suggestion) => ({
          ...suggestion,
          messageIds: suggestion.messageIds.filter((id) => {
            if (
              saved.has(
                messageUrl(moderationCase.guildId, suggestion.channelId, id),
              )
            ) {
              alreadyAdded.add(id);
              return false;
            }
            return true;
          }),
        }))
        .filter((suggestion) => suggestion.messageIds.length > 0);
      if (input.chosen.length > 0 && chosen.length === 0) {
        outcome = "already_added";
        return { kind: "already_added" };
      }
      const raw = await this.deps.suggestions.resolveLinksMany(
        [...chosen],
        this.resolveOptions(moderationCase),
      );
      const resolved = raw.map((result, index) => ({
        ...result,
        links: result.links.flatMap((link) => {
          const messageIds = link.messageIds.filter(
            (id) =>
              !saved.has(
                messageUrl(moderationCase.guildId, chosen[index].channelId, id),
              ),
          );
          if (saved.has(link.url) || messageIds.length === 0) {
            for (const id of link.messageIds) {
              alreadyAdded.add(id);
            }
            return [];
          }
          saved.add(link.url);
          return [{ ...link, messageIds }];
        }),
      }));
      const items = toProofItems([...chosen], resolved);
      const summary = summarize(
        moderationCase.caseId,
        resolved,
        items.length,
        null,
      );
      summary.alreadyAdded = alreadyAdded.size;
      links = summary.links;
      if (
        items.length === 0 &&
        alreadyAdded.size > 0 &&
        summary.pending === 0 &&
        summary.skipped.deleted_not_logged === 0 &&
        summary.skipped.unchecked === 0
      ) {
        outcome = "already_added";
        return { kind: "already_added" };
      }
      metrics.recordSkipped("pending", summary.pending);
      metrics.recordSkipped(
        "deleted_not_logged",
        summary.skipped.deleted_not_logged,
      );
      metrics.recordSkipped("unchecked", summary.skipped.unchecked);

      if (items.length === 0) {
        outcome = "nothing_linked";
        return { kind: "nothing_linked", summary };
      }

      const result = await this.deps.caseProofService.addSuggestions({
        guildId: moderationCase.guildId,
        caseId: moderationCase.caseId,
        authorId: input.authorId,
        items,
        exceptMessageId: input.exceptMessageId,
      });
      if (result.err) {
        if (result.val === "case_not_found") {
          outcome = "case_not_found";
          return { kind: "case_not_found" };
        }
        this.deps.logger.warn(
          {
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
            error: result.val,
          },
          "Suggested proof was refused",
        );
        return { kind: "failed" };
      }

      const partial =
        summary.pending > 0 ||
        summary.skipped.deleted_not_logged + summary.skipped.unchecked > 0 ||
        items.length < chosen.length;
      outcome = partial ? "partial" : "ok";
      return {
        kind: "added",
        batchId: result.val.batchId,
        summary: { ...summary, shown: result.val.shown },
      };
    } finally {
      metrics.recordAdded(
        input.surface,
        outcome,
        { userId: input.authorId, guildId: moderationCase.guildId },
        links,
      );
    }
  }
}
