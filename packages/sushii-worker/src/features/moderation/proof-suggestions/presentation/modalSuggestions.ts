import type { GuildMember } from "discord.js";
import type { Logger } from "pino";

import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { SuggestedProofOption } from "@/features/moderation/shared/presentation/proof/addProofModal";

import { viewerAccessFromMember } from "../application/viewerAccess";
import type { ViewerAccess } from "../application/viewerAccess";
import type { ProofSuggestion } from "../domain/ProofSuggestion";
import { checkboxLabel, plainSnippet, preselected } from "./suggestionText";

/** What the Add proof form listed, kept until its submit. */
export interface OfferedSuggestions {
  moderationCase: ModerationCase;
  suggestions: ProofSuggestion[];
  fingerprint: string;
  channelName: (channelId: string) => string | null;
}

/**
 * Current permissions without any REST call, for a modal that must be the
 * first response: private threads not already cached are denied.
 */
export function cachedViewerAccess(
  member: GuildMember,
  logger?: Logger,
): ViewerAccess {
  const access = viewerAccessFromMember(member, logger);
  return { ...access, prepare: async () => undefined };
}

export function suggestedOptions(
  offered: OfferedSuggestions,
): SuggestedProofOption[] {
  const { moderationCase } = offered;
  return offered.suggestions.map((suggestion, index) => {
    const channelId =
      suggestion.kind === "automod" && suggestion.blockedInChannelId
        ? suggestion.blockedInChannelId
        : suggestion.channelId;
    return {
      value: String(index),
      label: checkboxLabel(
        suggestion,
        offered.channelName(channelId),
        moderationCase.actionTime,
      ),
      description: plainSnippet(suggestion.snippet) || null,
      checked: preselected(suggestion),
    };
  });
}
