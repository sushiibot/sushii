import type { PromptDefinition } from "../domain/PromptDefinition";
import { followUpdatesPrompt } from "./followUpdates";
import { proofIntroPrompt } from "./proofIntro";

/** Checked in order; at most one prompt is shown per interaction. */
export const ALL_PROMPTS: readonly PromptDefinition[] = [
  followUpdatesPrompt,
  proofIntroPrompt,
];
