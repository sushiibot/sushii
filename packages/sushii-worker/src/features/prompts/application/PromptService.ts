import { sleep } from "bun";
import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import type { PromptDefinition } from "../domain/PromptDefinition";
import type { PromptStateData } from "../domain/PromptState";
import type { PromptStateRepository } from "../domain/repositories/PromptStateRepository";
import { buildPromptMessage } from "../presentation/views/buildPromptMessage";

const PROMPT_DELAY_MS = 2000;
const SNOOZE_DAYS = 7;

export class PromptService {
  constructor(
    private readonly repository: PromptStateRepository,
    private readonly prompts: readonly PromptDefinition[],
    private readonly logger: Logger,
  ) {}

  async maybePrompt(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
    try {
      await this.doMaybePrompt(interaction);
    } catch (error) {
      this.logger.error(
        { err: error, guildId: interaction.guildId },
        "Failed to run prompt check",
      );
    }
  }

  private async doMaybePrompt(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    // Triggers are expected to be fast synchronous checks. Avoid I/O in triggers.
    for (const prompt of this.prompts) {
      const triggered = await prompt.trigger(interaction);
      if (!triggered) {
        continue;
      }

      const guildId = BigInt(interaction.guildId);
      const state = await this.repository.findByGuildAndPrompt(guildId, prompt.id);

      if (!this.shouldShow(state, prompt)) {
        continue;
      }

      const threshold = this.getCooldownThreshold(prompt);
      const claimed = await this.repository.claimPromptSlot(guildId, prompt.id, threshold);
      if (!claimed) {
        continue;
      }

      const content = prompt.buildContent(interaction);
      const snoozeEnabled =
        prompt.repeatCooldown !== null && (prompt.snoozeEnabled ?? false);

      await sleep(PROMPT_DELAY_MS);

      const message = await interaction.followUp({
        ...buildPromptMessage(content, prompt.id, snoozeEnabled),
        ephemeral: false,
      });

      if (prompt.onSent) {
        prompt.onSent(message, { promptService: this, guildId }).catch((err) => {
          this.logger.error(
            { err, promptId: prompt.id, guildId },
            "Error in prompt onSent handler",
          );
        });
      }

      // Only one prompt per interaction
      break;
    }
  }

  shouldShow(state: PromptStateData | null, prompt: PromptDefinition): boolean {
    if (!state) {
      return true;
    }
    if (state.completedAt) {
      return false;
    }
    if (state.dismissedAt) {
      return false;
    }
    if (state.snoozeUntil && state.snoozeUntil > new Date()) {
      return false;
    }
    if (!state.lastPromptedAt) {
      return true;
    }
    if (prompt.repeatCooldown === null) {
      return false;
    }
    if (prompt.repeatCooldown === "daily") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return state.lastPromptedAt < today;
    }
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - prompt.repeatCooldown.days);
    return state.lastPromptedAt < threshold;
  }

  private getCooldownThreshold(prompt: PromptDefinition): Date | null {
    if (prompt.repeatCooldown === null) {
      return null;
    }
    if (prompt.repeatCooldown === "daily") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today;
    }
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - prompt.repeatCooldown.days);
    return threshold;
  }

  async recordSnoozed(guildId: bigint, promptId: string): Promise<void> {
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + SNOOZE_DAYS);
    await this.repository.recordSnoozed(guildId, promptId, snoozeUntil);
  }

  async recordDismissed(guildId: bigint, promptId: string): Promise<void> {
    await this.repository.recordDismissed(guildId, promptId);
  }

  async recordCompleted(guildId: bigint, promptId: string): Promise<void> {
    await this.repository.recordCompleted(guildId, promptId);
  }
}
