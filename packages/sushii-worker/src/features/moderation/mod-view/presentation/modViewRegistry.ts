import type { Logger } from "pino";

import type { ProofChangeListener } from "@/features/moderation/shared/application/ProofChangeListener";
import type {
  CaseProofCounts,
  CaseProofRepository,
} from "@/features/moderation/shared/domain/repositories/CaseProofRepository";

export interface LiveModView {
  guildId: string;
  caseIds(): string[];
  /** False once the entry interaction's token can no longer edit the reply. */
  canEdit(now: number): boolean;
  showProofCounts(counts: Map<string, CaseProofCounts>): Promise<void>;
}

export interface ModViewRegistry extends ProofChangeListener {
  register(view: LiveModView): void;
  unregister(view: LiveModView): void;
  /** Resolves once every matching view has refreshed; never rejects. */
  proofAdded(guildId: string, caseIds: string[]): Promise<void>;
}

interface ModViewRegistryDeps {
  caseProofRepository: Pick<CaseProofRepository, "countsByCases">;
  logger: Logger;
  now?: () => number;
}

export function createModViewRegistry(
  deps: ModViewRegistryDeps,
): ModViewRegistry {
  const views = new Set<LiveModView>();
  const now = deps.now ?? Date.now;

  async function refresh(view: LiveModView): Promise<void> {
    const counts = await deps.caseProofRepository.countsByCases(
      view.guildId,
      view.caseIds(),
    );
    await view.showProofCounts(counts);
  }

  async function proofAdded(guildId: string, caseIds: string[]) {
    const wanted = new Set(caseIds);
    const at = now();
    const matches: LiveModView[] = [];
    for (const view of views) {
      if (!view.canEdit(at)) {
        views.delete(view);
        continue;
      }
      if (
        view.guildId === guildId &&
        view.caseIds().some((id) => wanted.has(id))
      ) {
        matches.push(view);
      }
    }

    const results = await Promise.allSettled(matches.map(refresh));
    for (const result of results) {
      if (result.status === "rejected") {
        deps.logger.warn(
          { err: result.reason, guildId },
          "Failed to refresh mod view proof counts",
        );
      }
    }
  }

  return {
    register(view) {
      views.add(view);
    },
    unregister(view) {
      views.delete(view);
    },
    proofAdded(guildId, caseIds) {
      return proofAdded(guildId, caseIds).catch((err: unknown) => {
        deps.logger.warn(
          { err, guildId },
          "Failed to refresh mod view proof counts",
        );
      });
    },
  };
}
