import type { ActionRowBuilder, ChatInputCommandInteraction, Message, MessageActionRowComponentBuilder } from "discord.js";

import type { PromptService } from "../application/PromptService";

export interface PromptContent {
  text: string;
  accentColor?: number;
  actionRow?: ActionRowBuilder<MessageActionRowComponentBuilder>;
}

export interface PromptHandlerContext {
  promptService: PromptService;
  guildId: bigint;
}

// Discriminated union: snooze requires a repeat cooldown — a one-shot prompt
// can't snooze because there's nothing to come back to.
type WithRepeat = {
  repeatCooldown: "daily" | { days: number };
  snoozeEnabled: boolean;
};

type WithoutRepeat = {
  repeatCooldown: null;
  snoozeEnabled?: never;
};

export type PromptDefinition = (WithRepeat | WithoutRepeat) & {
  readonly id: string;
  readonly scope: "guild";
  trigger(interaction: ChatInputCommandInteraction<"cached">): Promise<boolean>;
  buildContent(interaction: ChatInputCommandInteraction<"cached">): PromptContent;
  // Called with the sent message so the prompt can set up its own component
  // collector for any custom action (e.g. channel select). Snooze/dismiss are
  // handled globally by PromptButtonHandler and do not need to be handled here.
  onSent?(message: Message<true>, ctx: PromptHandlerContext): Promise<void>;
};
