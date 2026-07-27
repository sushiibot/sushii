import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

import Color from "@/utils/colors";

import type { RemoveMemberOutcome } from "../../domain/repositories/AltAccountRepository";
import type { LinkAccountsOutcome } from "../../application/LinkAccountsService";
import type { SetNicknameOutcome } from "../../application/SetNicknameService";
import { buildAltIdentityContainer } from "./AltIdentityView";

/** Echoed user input is capped so a pasted paragraph can't blow the text budget. */
const MAX_ECHOED_ENTRIES = 5;
const MAX_ECHOED_LENGTH = 20;

function simpleContainer(content: string, color: Color): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function formatMentionList(userIds: string[]): string {
  const shown = userIds.slice(0, 10).map((id) => `<@${id}>`);
  const omitted = userIds.length - shown.length;

  return omitted > 0
    ? `${shown.join(", ")} and ${omitted} more`
    : shown.join(", ");
}

function formatEchoedEntries(entries: string[]): string {
  const shown = entries
    .slice(0, MAX_ECHOED_ENTRIES)
    .map((entry) =>
      entry.length > MAX_ECHOED_LENGTH
        ? `\`${entry.slice(0, MAX_ECHOED_LENGTH)}…\``
        : `\`${entry}\``,
    );
  const omitted = entries.length - shown.length;

  return omitted > 0
    ? `${shown.join(", ")} and ${omitted} more`
    : shown.join(", ");
}

export interface LinkOutcomeContext {
  /** The two required user options, used for the headline wording. */
  primaryUserIds: [string, string];
  reason: string | null;
  /** Unparseable entries from `additional_accounts`. */
  invalidTokens: string[];
  /** Well-formed snowflakes Discord couldn't resolve. */
  unresolvedIds: string[];
}

export function buildLinkOutcomeContainer(
  outcome: LinkAccountsOutcome,
  context: LinkOutcomeContext,
): ContainerBuilder {
  const [userIdA, userIdB] = context.primaryUserIds;
  const { reason, invalidTokens, unresolvedIds } = context;
  const merged = outcome.mergedIdentityIds.length > 0;
  const added = outcome.addedUserIds.length > 0;

  const lines: string[] = [];
  let color = Color.Success;

  if (!added && !merged) {
    const others = outcome.alreadyLinkedUserIds.length - 2;
    const extra = others > 0 ? ` (and ${others} other account(s))` : "";

    lines.push(
      `<@${userIdA}> and <@${userIdB}>${extra} are **already linked** to the same identity.`,
    );
    color = Color.Info;
  } else if (outcome.identityCreated) {
    lines.push(
      `**Linked** ${outcome.identity.members.length} accounts as a new identity.`,
    );
  } else if (merged) {
    lines.push(
      `**Merged** ${outcome.mergedIdentityIds.length + 1} identities into one.`,
    );

    if (added) {
      lines.push(`Also added ${formatMentionList(outcome.addedUserIds)}.`);
    }
  } else {
    lines.push(
      `**Added** ${formatMentionList(outcome.addedUserIds)} to an existing identity.`,
    );
  }

  if (merged) {
    const dropped = outcome.discardedNicknames
      .map((nickname) => `**${nickname}**`)
      .join(", ");
    const rename = " (use `/alts nickname` to rename)";

    if (outcome.adoptedNickname) {
      const alsoDropped = dropped ? `, dropping ${dropped}` : "";
      lines.push(
        `Took the nickname **${outcome.adoptedNickname}** from a merged identity${alsoDropped}${rename}.`,
      );
    } else if (outcome.keptNickname && dropped) {
      lines.push(
        `Kept nickname **${outcome.keptNickname}**, dropping ${dropped}${rename}.`,
      );
    }
  }

  if (reason) {
    // A merge alone writes no member rows, so there's nowhere to persist it.
    const caveat =
      merged && !added ? " (not saved — merges don't persist a reason)" : "";
    lines.push(`**Reason:** ${reason}${caveat}`);
  }

  if (outcome.skippedBotIds.length > 0) {
    lines.push(
      `-# Skipped ${outcome.skippedBotIds.length} bot account(s): ${formatMentionList(outcome.skippedBotIds)}`,
    );
  }

  if (unresolvedIds.length > 0) {
    lines.push(
      `-# Couldn't find ${unresolvedIds.length} account(s): ${formatEchoedEntries(unresolvedIds)}`,
    );
  }

  if (invalidTokens.length > 0) {
    lines.push(
      `-# Ignored ${invalidTokens.length} unrecognized entr${invalidTokens.length === 1 ? "y" : "ies"}: ${formatEchoedEntries(invalidTokens)}`,
    );
  }

  return buildAltIdentityContainer(outcome.identity, {
    note: lines.join("\n"),
    color,
    highlightUserIds: outcome.addedUserIds,
  });
}

export function buildUnlinkOutcomeContainer(
  outcome: RemoveMemberOutcome,
  userId: string,
  reason: string | null,
): ContainerBuilder {
  if (outcome.kind === "notLinked") {
    return simpleContainer(
      `<@${userId}> isn't linked to any identity in this server.`,
      Color.Info,
    );
  }

  let content = `Unlinked <@${userId}> from its identity.`;
  if (outcome.identityDeleted) {
    content += " That identity had no other members, so it was removed.";
  }
  if (reason) {
    content += `\n**Reason:** ${reason} (not saved)`;
  }

  return simpleContainer(content, Color.Success);
}

export function formatNicknameChangeMessage(nickname: string | null): string {
  return nickname
    ? `Set the identity's nickname to **${nickname}**.`
    : "Cleared the identity's nickname.";
}

export function buildNicknameOutcomeContainer(
  outcome: SetNicknameOutcome,
  userId: string,
  nickname: string | null,
): ContainerBuilder {
  if (outcome.kind === "noIdentity") {
    return simpleContainer(
      `<@${userId}> has no linked identity to name.`,
      Color.Warning,
    );
  }

  return simpleContainer(formatNicknameChangeMessage(nickname), Color.Success);
}
