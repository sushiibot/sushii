import type { PromptDefinition } from "../domain/PromptDefinition";
import { followUpdatesPrompt } from "./followUpdates";

// NOTE: Only the first prompt whose trigger() returns true fires per interaction.
// Ensure triggers do not overlap to avoid one prompt silently shadowing another.
export const ALL_PROMPTS: readonly PromptDefinition[] = [followUpdatesPrompt];
