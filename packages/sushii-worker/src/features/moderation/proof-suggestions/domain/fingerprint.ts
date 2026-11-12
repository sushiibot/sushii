import { createHash } from "node:crypto";

import type { ProofSuggestion } from "./ProofSuggestion";

/** Order-independent, so handlers can compare a recomputed set with the one a mod saw. */
export function fingerprintSuggestions(
  suggestions: Pick<ProofSuggestion, "kind" | "messageIds">[],
): string {
  const entries = suggestions
    .map((s) => `${s.kind}:${[...s.messageIds].sort().join(",")}`)
    .sort();

  return createHash("sha1").update(entries.join("|")).digest("hex").slice(0, 8);
}
