import { sleep as bunSleep } from "bun";
import type {
  APIMessageTopLevelComponent,
  ChatInputCommandInteraction,
} from "discord.js";
import { DiscordAPIError, SnowflakeUtil } from "discord.js";

import { withSuggestionBlock } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";

import { viewerAccessFromMember } from "../application/viewerAccess";
import type { ViewerAccess } from "../application/viewerAccess";
import type { ProofSuggestion } from "../domain/ProofSuggestion";
import type { SuggestionFlow } from "./SuggestionFlow";
import { buildResponseSuggestionBlock } from "./views";

const SETTLE_WAIT_MS = 5_000;
const SETTLE_POLL_MS = 500;

export interface ResponseSuggestionsInput {
  interaction: ChatInputCommandInteraction<"cached">;
  moderationCase: ModerationCase;
  /** How far back the action deleted the target's messages; 0 or null for none. */
  purgeWindowSeconds: number | null;
}

/** Every message the purge covers already shows as deleted, so labels say deleted rather than live. */
export function purgeSettled(
  suggestions: readonly ProofSuggestion[],
  actionTime: Date,
  purgeWindowSeconds: number,
): boolean {
  const since = actionTime.getTime() - purgeWindowSeconds * 1000;
  return suggestions.every((s) => {
    if (s.kind !== "recent") {
      return true;
    }
    const purged = s.messageIds.filter(
      (id) => SnowflakeUtil.timestampFrom(id) >= since,
    ).length;
    return purged <= (s.deletedCount ?? 0);
  });
}

/** Adds the suggested proof block to a single-target action response once it's posted. */
export class ResponseSuggestions {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly flow: SuggestionFlow,
    options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
  ) {
    this.sleep = options.sleep ?? bunSleep;
    this.now = options.now ?? Date.now;
  }

  /** Never throws: the action and its response already happened. */
  async attach(input: ResponseSuggestionsInput): Promise<void> {
    const { interaction, moderationCase } = input;
    const context = {
      guildId: moderationCase.guildId,
      caseId: moderationCase.caseId,
    };
    try {
      if (!this.flow.eligible(moderationCase)) {
        return;
      }

      const access = viewerAccessFromMember(
        interaction.member,
        this.flow.deps.logger,
      );
      const suggestions = await this.settledSuggestions(
        moderationCase,
        access,
        input.purgeWindowSeconds ?? 0,
      );
      if (suggestions.length === 0) {
        return;
      }

      // Fetched now so an edit made while waiting (e.g. Edit reason) isn't overwritten.
      const reply = await interaction.fetchReply();
      const posted = reply.components.map((c) =>
        c.toJSON(),
      ) as APIMessageTopLevelComponent[];
      const updated = withSuggestionBlock(
        posted,
        buildResponseSuggestionBlock({
          caseId: moderationCase.caseId,
          fingerprint: this.flow.fingerprint(suggestions),
          suggestions,
          targetName: moderationCase.userTag,
          actionType: moderationCase.actionType,
        }),
      );
      if (!updated) {
        return;
      }

      await interaction.editReply(updated);
      this.flow.metrics.recordShown("response", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
    } catch (err) {
      // Best effort: the response just goes without suggestions.
      const log = err instanceof DiscordAPIError ? "warn" : "error";
      this.flow.deps.logger[log](
        { err, ...context },
        "Failed to add suggested proof to the action response",
      );
    }
  }

  private async settledSuggestions(
    moderationCase: ModerationCase,
    access: ViewerAccess,
    purgeWindowSeconds: number,
  ): Promise<ProofSuggestion[]> {
    let suggestions = await this.flow.compute(moderationCase, access);
    if (purgeWindowSeconds <= 0) {
      return suggestions;
    }

    const deadline = this.now() + SETTLE_WAIT_MS;
    while (
      !purgeSettled(
        suggestions,
        moderationCase.actionTime,
        purgeWindowSeconds,
      ) &&
      this.now() < deadline
    ) {
      await this.sleep(SETTLE_POLL_MS);
      suggestions = await this.flow.compute(moderationCase, access);
    }
    return suggestions;
  }
}
