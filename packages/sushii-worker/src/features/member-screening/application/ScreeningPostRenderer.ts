import type { ContainerBuilder } from "discord.js";

import type { ScreeningGuildRepository } from "../domain/repositories/ScreeningGuildRepository";
import type { ScreeningVerdictRepository } from "../domain/repositories/ScreeningVerdictRepository";
import {
  ACTION_LOOKBACK_DAYS,
  SCREENING_DEFAULTS,
  type ScreeningVerdict,
} from "../domain/types";
import { buildScreeningPost } from "../presentation/views/ScreeningPostView";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rebuilds a review post from stored verdicts, so edits never depend on the flagged message still existing. */
export class ScreeningPostRenderer {
  constructor(
    private readonly guildRepo: Pick<ScreeningGuildRepository, "findByGuildId">,
    private readonly verdictRepo: ScreeningVerdictRepository,
  ) {}

  /** Null when no verdict is attached to the post. */
  async renderPost(postMessageId: string): Promise<ContainerBuilder | null> {
    const latest = await this.verdictRepo.latestForPost(postMessageId);
    if (!latest) {
      return null;
    }

    return this.render(latest);
  }

  /** Shows the member's AutoMod blocks since joining alongside the flag. */
  async render(verdict: ScreeningVerdict): Promise<ContainerBuilder> {
    // Display only, not a gate: posts stay actionable after screening is turned off.
    const settings = await this.guildRepo.findByGuildId(verdict.guildId);
    const since =
      verdict.joinedAt ??
      new Date(verdict.createdAt.getTime() - ACTION_LOOKBACK_DAYS * DAY_MS);
    const automod = await this.verdictRepo.automodSummary(
      verdict.guildId,
      verdict.userId,
      since,
    );

    return buildScreeningPost(verdict, {
      reviewThreshold:
        settings?.reviewThreshold ?? SCREENING_DEFAULTS.reviewThreshold,
      automod,
    });
  }
}
