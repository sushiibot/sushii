import type { ImageKind, ScreeningRule, ScreeningRuleId } from "./types";

/** Only the new message is judged; earlier lines are context. No display names: they caused false positives. */
export interface TextState {
  new_message: { text: string };
  earlier_messages_from_same_member?: string[];
}

export interface TextVerdict {
  scores: Partial<Record<ScreeningRuleId, number>>;
  model: string;
  cost: number | null;
}

export interface ImageVerdict {
  unsafe: boolean;
  categories: string[];
  reason: string;
  model: string;
  cost: number | null;
}

export interface ScreeningClassifier {
  classifyText(
    state: TextState,
    rules: readonly ScreeningRule[],
  ): Promise<TextVerdict>;
  /** `imageUrl` must be Discord-hosted; the provider fetches it. */
  classifyImage(imageUrl: string, kind: ImageKind): Promise<ImageVerdict>;
}
