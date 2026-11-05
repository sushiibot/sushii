import type {
  ActionRowBuilder,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  RepliableInteraction,
} from "discord.js";

import type { PromptScope, PromptSubject } from "./PromptState";

export type PromptInteraction = RepliableInteraction<"cached">;

export interface PromptContent {
  text: string;
  accentColor?: number;
  rows?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

export interface PromptActionContext {
  subject: PromptSubject;
  recordCompleted(): Promise<void>;
  recordDismissed(): Promise<void>;
}

type Repeat =
  | { repeat: { days: number }; snoozeDays?: number }
  | { repeat: null; snoozeDays?: never };

export type PromptDefinition = Repeat & {
  readonly id: string;
  readonly scope: PromptScope;
  /** Stops being offered from this moment. */
  readonly activeUntil?: Date;
  /**
   * "auto": considered after any successful slash command.
   * "explicit": only shown when feature code calls `PromptService.offer()`.
   */
  readonly delivery: "auto" | "explicit";
  /** Cheap checks only (permissions, config already in cache). */
  eligible(interaction: PromptInteraction): Promise<boolean>;
  build(interaction: PromptInteraction): Promise<PromptContent> | PromptContent;
  /** Re-checked on every button/select click, since a sent prompt stays clickable after permissions change. */
  canAct?(interaction: MessageComponentInteraction<"cached">): boolean;
  /** Custom component actions, routed by `prompt:<id>:<action>` custom IDs. Snooze and dismiss are handled for every prompt. */
  handleAction?(
    interaction: MessageComponentInteraction<"cached">,
    action: string,
    ctx: PromptActionContext,
  ): Promise<void>;
};
