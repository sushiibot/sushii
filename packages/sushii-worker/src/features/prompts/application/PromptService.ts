import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";
import type { Logger } from "pino";

import {
  type ProductEventTracker,
  noopProductEvents,
} from "@/features/product-analytics/domain/ProductEvent";

import type {
  PromptActionContext,
  PromptDefinition,
  PromptInteraction,
} from "../domain/PromptDefinition";
import type { PromptStateData, PromptSubject } from "../domain/PromptState";
import type { PromptStateRepository } from "../domain/repositories/PromptStateRepository";
import type { PromptMetrics } from "../infrastructure/PromptMetrics";
import { buildPromptMessage } from "../presentation/views/buildPromptMessage";

const DAY_MS = 24 * 60 * 60 * 1000;
/** At most one prompt of any kind per person in this window. */
export const USER_PROMPT_CAP_DAYS = 7;
const DEFAULT_SNOOZE_DAYS = 7;
/** Interaction tokens stay valid for 15 minutes. */
const SEEN_INTERACTION_TTL_MS = 15 * 60 * 1000;

export class PromptService {
  private readonly promptedInteractions = new Set<string>();
  private readonly byId: ReadonlyMap<string, PromptDefinition>;

  constructor(
    private readonly repository: PromptStateRepository,
    private readonly prompts: readonly PromptDefinition[],
    private readonly metrics: PromptMetrics,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly productEvents: ProductEventTracker = noopProductEvents,
  ) {
    this.byId = new Map(prompts.map((p) => [p.id, p]));
  }

  getPrompt(promptId: string): PromptDefinition | undefined {
    return this.byId.get(promptId);
  }

  /** Best-effort follow-up after the caller has already responded; never throws. */
  async offer(interaction: PromptInteraction, promptId: string): Promise<void> {
    const prompt = this.byId.get(promptId);
    if (!prompt) {
      this.logger.warn({ promptId }, "Offered an unknown prompt");
      return;
    }
    await this.tryShow(interaction, [prompt]);
  }

  /** Called by the router after a slash command handler finishes without throwing. */
  async afterCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      return;
    }
    // A modal-only response leaves ephemeral null, and a follow-up to an unedited defer would replace its placeholder.
    if (!interaction.replied || interaction.ephemeral === null) {
      return;
    }
    await this.tryShow(
      interaction,
      this.prompts.filter((p) => p.delivery === "auto"),
    );
  }

  private async tryShow(
    interaction: PromptInteraction,
    candidates: readonly PromptDefinition[],
  ): Promise<void> {
    if (this.promptedInteractions.has(interaction.id)) {
      return;
    }

    try {
      for (const prompt of candidates) {
        const shown = await this.tryShowOne(interaction, prompt);
        if (shown !== "next") {
          return;
        }
      }
    } catch (err) {
      this.logger.error(
        { err, guildId: interaction.guildId, userId: interaction.user.id },
        "Failed to run prompt check",
      );
    }
  }

  /** "next" moves on to the next candidate; anything else ends the check for this interaction. */
  private async tryShowOne(
    interaction: PromptInteraction,
    prompt: PromptDefinition,
  ): Promise<"shown" | "stop" | "next"> {
    const now = this.now();
    if (prompt.activeUntil && now >= prompt.activeUntil) {
      return "next";
    }
    if (!(await prompt.eligible(interaction))) {
      return "next";
    }

    const subject = this.subjectFor(prompt, interaction);
    const state = await this.repository.find(subject, prompt.id);
    if (!this.shouldShow(state, prompt, now)) {
      return "next";
    }

    const userId = BigInt(interaction.user.id);
    const lastShown = await this.repository.lastShownToUser(userId);
    if (
      lastShown &&
      now.getTime() - lastShown.getTime() < USER_PROMPT_CAP_DAYS * DAY_MS
    ) {
      this.metrics.recordSkipped(prompt.id, "cap");
      return "stop";
    }

    const claim = await this.repository.claim(
      subject,
      prompt.id,
      this.cooldownThreshold(prompt, now),
    );
    if (!claim) {
      return "next";
    }

    this.markPrompted(interaction.id);
    try {
      const content = await prompt.build(interaction);
      await interaction.followUp(buildPromptMessage(content));
    } catch (err) {
      await this.repository.release(subject, prompt.id, claim.previous);
      this.metrics.recordSkipped(prompt.id, "send_failed");
      this.logger.warn(
        { err, promptId: prompt.id, guildId: interaction.guildId },
        "Failed to send prompt",
      );
      return "stop";
    }

    if (subject.scope === "guild") {
      await this.repository.recordShownToUser(userId, prompt.id, now);
    }
    this.metrics.recordShown(prompt.id);
    this.productEvents.track({
      name: "prompt.shown",
      userId: interaction.user.id,
      guildId: interaction.guildId,
      props: { prompt: prompt.id },
    });
    return "shown";
  }

  shouldShow(
    state: PromptStateData | null,
    prompt: PromptDefinition,
    now: Date = this.now(),
  ): boolean {
    if (!state) {
      return true;
    }
    if (state.completedAt || state.dismissedAt) {
      return false;
    }
    if (state.snoozeUntil && state.snoozeUntil > now) {
      return false;
    }
    if (!state.lastPromptedAt) {
      return true;
    }
    const threshold = this.cooldownThreshold(prompt, now);
    return threshold !== null && state.lastPromptedAt < threshold;
  }

  private cooldownThreshold(prompt: PromptDefinition, now: Date): Date | null {
    if (prompt.repeat === null) {
      return null;
    }
    return new Date(now.getTime() - prompt.repeat.days * DAY_MS);
  }

  subjectFor(
    prompt: PromptDefinition,
    interaction: { guildId: string; user: { id: string } },
  ): PromptSubject {
    return prompt.scope === "guild"
      ? { scope: "guild", id: BigInt(interaction.guildId) }
      : { scope: "user", id: BigInt(interaction.user.id) };
  }

  actionContext(
    prompt: PromptDefinition,
    interaction: MessageComponentInteraction<"cached">,
  ): PromptActionContext {
    const subject = this.subjectFor(prompt, interaction);
    return {
      subject,
      recordCompleted: async () => {
        await this.repository.recordCompleted(subject, prompt.id);
        this.productEvents.track({
          name: "prompt.action",
          userId: interaction.user.id,
          guildId: interaction.guildId,
          props: { prompt: prompt.id, action: "completed" },
        });
      },
      recordDismissed: () =>
        this.repository.recordDismissed(subject, prompt.id),
    };
  }

  snoozeDays(prompt: PromptDefinition): number {
    return prompt.snoozeDays ?? DEFAULT_SNOOZE_DAYS;
  }

  async recordSnoozed(
    prompt: PromptDefinition,
    subject: PromptSubject,
  ): Promise<void> {
    const until = new Date(
      this.now().getTime() + this.snoozeDays(prompt) * DAY_MS,
    );
    await this.repository.recordSnoozed(subject, prompt.id, until);
  }

  async recordDismissed(
    prompt: PromptDefinition,
    subject: PromptSubject,
  ): Promise<void> {
    await this.repository.recordDismissed(subject, prompt.id);
  }

  recordAction(
    promptId: string,
    action: string,
    interaction: Pick<PromptInteraction, "user" | "guildId">,
  ): void {
    this.metrics.recordAction(promptId, action);
    this.productEvents.track({
      name: "prompt.action",
      userId: interaction.user.id,
      guildId: interaction.guildId,
      props: { prompt: promptId, action },
    });
  }

  private markPrompted(interactionId: string): void {
    this.promptedInteractions.add(interactionId);
    setTimeout(
      () => this.promptedInteractions.delete(interactionId),
      SEEN_INTERACTION_TTL_MS,
    ).unref?.();
  }
}
