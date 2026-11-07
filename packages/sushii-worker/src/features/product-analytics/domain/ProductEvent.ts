import { createHmac } from "node:crypto";

export type ProductEventName =
  | "interaction.command"
  | "interaction.context_menu"
  | "interaction.button"
  | "interaction.select"
  | "interaction.modal"
  | "prompt.shown"
  | "prompt.action"
  | "feedback.submitted"
  | "proof.added"
  | "update.relayed";

/** Values must come from code, never from user input: this table has no free text. */
export type ProductEventProps = Readonly<Record<string, string>>;

export interface ProductEventInput {
  name: ProductEventName;
  /** Required for interaction events, which are mapped by handler; others use their name. */
  feature?: string;
  userId: string | null;
  guildId: string | null;
  props?: ProductEventProps;
}

export interface ProductEventRow {
  name: ProductEventName;
  feature: string;
  guildId: bigint | null;
  actor: Buffer | null;
  props: ProductEventProps;
}

export interface ProductEventTracker {
  /** Best-effort: never throws and never delays the caller. */
  track(event: ProductEventInput): void;
}

export const noopProductEvents: ProductEventTracker = {
  track: () => undefined,
};

export const UNMATCHED_FEATURE = "unmatched";
export const ALL_FEATURES = "all";
/** The bot posting on its own: it keeps a feature row but never makes a server active. */
export const SYSTEM_EVENT: ProductEventName = "update.relayed";

const EVENT_FEATURES: Partial<Record<ProductEventName, string>> = {
  "prompt.shown": "prompts",
  "prompt.action": "prompts",
  "feedback.submitted": "feedback",
  "proof.added": "moderation",
  "update.relayed": "sushii-updates",
};

export function featureForEvent(event: ProductEventInput): string {
  return event.feature ?? EVENT_FEATURES[event.name] ?? UNMATCHED_FEATURE;
}

/** Keyed so nobody can hash a list of public Discord IDs and compare. */
export function actorCode(key: string, userId: string): Buffer {
  return createHmac("sha256", key).update(userId).digest().subarray(0, 16);
}
