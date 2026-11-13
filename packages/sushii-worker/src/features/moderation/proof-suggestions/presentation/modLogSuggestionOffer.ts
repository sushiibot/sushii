import type { ModLogSuggestionOffer } from "@/features/moderation/shared/application/ModLogMessageService";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";

import type { ProofSuggestionService } from "../application/ProofSuggestionService";
import { buildReviewId } from "./customIds";
import { savedSuggestionLinks } from "./savedProof";
import { SUGGESTION_ACTIONS } from "./suggestionText";

/** Viewer-agnostic: the click recomputes for the mod, so the button never says what exists. */
export function createModLogSuggestionOffer(deps: {
  suggestions: Pick<ProofSuggestionService, "hasCandidates">;
  caseProofRepository: Pick<CaseProofRepository, "listByCase">;
}): ModLogSuggestionOffer {
  return {
    async buttonFor(moderationCase) {
      if (!SUGGESTION_ACTIONS.has(moderationCase.actionType)) {
        return null;
      }
      const proofs = await deps.caseProofRepository.listByCase(
        moderationCase.guildId,
        moderationCase.caseId,
      );
      if (proofs.some((proof) => proof.source !== "suggestion")) {
        return null;
      }
      const has = await deps.suggestions.hasCandidates({
        guildId: moderationCase.guildId,
        targetId: moderationCase.userId,
        actionTime: moderationCase.actionTime,
        savedMessageLinks: savedSuggestionLinks(proofs),
      });
      return has ? buildReviewId(moderationCase.caseId, null) : null;
    },
  };
}
