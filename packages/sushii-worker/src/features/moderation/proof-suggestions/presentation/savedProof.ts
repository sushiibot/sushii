import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";

export function savedSuggestionLinks(proofs: readonly CaseProof[]): string[] {
  return proofs
    .filter((proof) => proof.source === "suggestion")
    .flatMap((proof) => {
      const content = proof.content ?? "";
      const separator = content.lastIndexOf(" · ");
      const links = separator === -1 ? "" : content.slice(separator + 3);
      return [
        ...links.matchAll(/https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+/g),
      ].map((match) => match[0]);
    });
}
