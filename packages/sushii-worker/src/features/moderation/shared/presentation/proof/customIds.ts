import {
  decodeCaseIds,
  toCaseRuns,
} from "@/features/moderation/actions/presentation/response/customIds";

export const ADD_PROOF_PREFIX = "caseProof/add/";

const CUSTOM_ID_MAX_LENGTH = 100;

/** Throws when the cases don't fit; any set the action response can encode fits. */
export function buildAddProofCustomId(caseIds: string[]): string {
  const encoded = toCaseRuns(caseIds).join(",");
  if (!encoded) {
    throw new Error("Add proof custom ID needs at least one case ID");
  }

  const customId = ADD_PROOF_PREFIX + encoded;
  if (customId.length > CUSTOM_ID_MAX_LENGTH) {
    throw new Error("Add proof custom ID exceeds 100 characters", {
      cause: { caseCount: caseIds.length, length: customId.length },
    });
  }

  return customId;
}

export function parseAddProofCustomId(customId: string): string[] | null {
  if (!customId.startsWith(ADD_PROOF_PREFIX)) {
    return null;
  }

  return decodeCaseIds(customId.slice(ADD_PROOF_PREFIX.length));
}
