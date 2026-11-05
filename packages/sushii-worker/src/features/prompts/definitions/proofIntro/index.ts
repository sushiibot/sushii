import type { PromptDefinition } from "../../domain/PromptDefinition";
import { PROOF_INTRO_ID, buildProofIntroContent } from "./message";

export const proofIntroPrompt: PromptDefinition = {
  id: PROOF_INTRO_ID,
  scope: "user",
  repeat: null,
  activeUntil: new Date("2027-01-03T00:00:00Z"),
  delivery: "explicit",

  async eligible() {
    return true;
  },

  build() {
    return buildProofIntroContent();
  },
};
