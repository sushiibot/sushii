import { escapeMarkdown } from "discord.js";

import { PROOF_CONTENT_MAX_LENGTH } from "@/features/moderation/shared/domain/entities/CaseProof";

import type { ProofSuggestion } from "./ProofSuggestion";

export interface ResolvedLink {
  url: string;
  source: "log" | "message";
  /** Log channel for log links, the message's channel otherwise. */
  channelId: string;
  /** The suggestion's messages this link shows (a bulk log post can hold many). */
  messageIds: string[];
}

export type SkipReason = "deleted_not_logged" | "unchecked";

export interface SkippedMessage {
  messageId: string;
  reason: SkipReason;
}

export interface ResolvedSuggestionLinks {
  links: ResolvedLink[];
  /** Deleted by a fresh ban and not in the message log yet. */
  pending: string[];
  skipped: SkippedMessage[];
}

export const MAX_LINKS_PER_PROOF = 10;
const LABEL_MAX_LENGTH = 200;
const RULE_NAME_MAX_LENGTH = 100;

const EMOJI: Record<ProofSuggestion["kind"], string> = {
  automod: "🤖",
  deleted: "🗑️",
  recent: "💬",
};

export function messageUrl(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return text;
  }

  return `${chars.slice(0, max - 1).join("")}…`;
}

function proofLabel(
  suggestion: ProofSuggestion,
  resolved: ResolvedSuggestionLinks,
): string {
  const emoji = EMOJI[suggestion.kind];

  if (suggestion.kind === "automod") {
    const rule = truncate(
      escapeMarkdown(suggestion.ruleName ?? "AutoMod"),
      RULE_NAME_MAX_LENGTH,
    );
    const where = suggestion.blockedInChannelId
      ? ` in <#${suggestion.blockedInChannelId}>`
      : "";
    return `${emoji} AutoMod alert: ${rule}${where}`;
  }

  const linked = resolved.links.flatMap((l) => l.messageIds);
  const fromLog = resolved.links
    .filter((l) => l.source === "log")
    .flatMap((l) => l.messageIds).length;

  if (suggestion.kind === "deleted" || fromLog === linked.length) {
    return `${emoji} ${plural(linked.length, "deleted message")} in <#${suggestion.channelId}>`;
  }

  const deletedNote = fromLog > 0 ? ` (${fromLog} deleted)` : "";
  return `${emoji} ${plural(linked.length, "message")} in <#${suggestion.channelId}>${deletedNote}`;
}

function linkVariants(links: ResolvedLink[]): string[] {
  const urls = links.map((l) => l.url);
  const variants: string[] = [];
  if (urls.length <= MAX_LINKS_PER_PROOF) {
    variants.push(urls.join(" "));
  }

  // The log channel holds every deleted message; message links all share the suggestion's channel.
  const overflowChannel = (
    links.find((l) => l.source === "log") ?? links[links.length - 1]
  ).channelId;

  if (urls.length >= 3) {
    variants.push(
      `${urls[0]} ${urls[urls.length - 1]} +${urls.length - 2} more in <#${overflowChannel}>`,
    );
  }

  if (urls.length >= 2) {
    variants.push(
      `${urls[0]} +${urls.length - 1} more in <#${overflowChannel}>`,
    );
  }

  return variants;
}

/** Shortens the label rather than cutting a URL. */
export function fitProofContent(
  label: string,
  links: string,
  max: number = PROOF_CONTENT_MAX_LENGTH,
): string {
  const tail = ` · ${links}`;
  const room = max - tail.length;
  if (room >= 2) {
    return `${truncate(label, room)}${tail}`;
  }

  const firstUrl = links.split(" ")[0];
  return firstUrl.length <= max ? firstUrl : truncate(label, max);
}

/** Link-only proof row, or null when nothing resolved to a link. */
export function formatProofContent(
  suggestion: ProofSuggestion,
  resolved: ResolvedSuggestionLinks,
): string | null {
  if (resolved.links.length === 0) {
    return null;
  }

  const label = truncate(proofLabel(suggestion, resolved), LABEL_MAX_LENGTH);
  const variants = linkVariants(resolved.links);

  for (const links of variants) {
    const content = `${label} · ${links}`;
    if (content.length <= PROOF_CONTENT_MAX_LENGTH) {
      return content;
    }
  }

  // A label plus one URL is far below the limit; this only guards odd inputs.
  return fitProofContent(label, variants[variants.length - 1] ?? "");
}

export function toProofItems(
  suggestions: ProofSuggestion[],
  resolved: ResolvedSuggestionLinks[],
): { content: string }[] {
  const items: { content: string }[] = [];
  suggestions.forEach((suggestion, i) => {
    const links = resolved[i];
    if (!links) {
      return;
    }

    const content = formatProofContent(suggestion, links);
    if (content) {
      items.push({ content });
    }
  });

  return items;
}
