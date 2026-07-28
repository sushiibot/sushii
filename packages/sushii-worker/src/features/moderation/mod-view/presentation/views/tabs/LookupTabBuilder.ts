import { TextDisplayBuilder } from "discord.js";

import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import { formatBanEntry } from "@/features/moderation/cases/presentation/views/LookupBanEntryFormatter";
import { chunkItems } from "@/shared/presentation/packLines";
import { countWithNoun } from "@/shared/presentation/pluralize";

import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import { addStateLine, addSubtextBlock } from "../components/ModViewChrome";

/** Verbatim copy from `LookupCommand.ts` — preserved as-is, not paraphrased. */
const PUBLIC_SERVER_REQUIREMENT_COPY =
  "This feature is only available for public (discoverable) servers with 1000+ members. Partnered and verified servers are also eligible.";

/**
 * Bin-pack cross-server bans into pages for the Lookup tab's paginator. Bans
 * are expected pre-sorted largest-server-first by `LookupUserService`;
 * chunking preserves that order within and across pages. Drops nothing.
 */
export function chunkLookupBans(
  bans: readonly UserLookupBan[],
  currentGuildOptIn: boolean,
): UserLookupBan[][] {
  return chunkItems(bans, (ban) => formatBanEntry(ban, currentGuildOptIn));
}

/**
 * Lookup tab — paginated (chunkItems, like History). Reuses `formatBanEntry`
 * verbatim: it already withholds server name/reason/size unless both guilds
 * opted in, and always shows badges.
 */
export const addLookupTabContent: ModViewTabContentBuilder = (
  container,
  options,
) => {
  const { lookup } = options.data;

  if (lookup === null) {
    addStateLine(
      container,
      "Cross-server lookup not available",
      PUBLIC_SERVER_REQUIREMENT_COPY,
    );
    return;
  }

  const { crossServerBans, currentGuildLookupOptIn } = lookup;

  if (crossServerBans.length === 0) {
    addStateLine(
      container,
      "No cross-server bans found",
      "Searched all servers, including anonymous (non-sharing) ones.",
    );
    return;
  }

  const total = crossServerBans.length;
  const scopeLines = [
    `${countWithNoun(total, "ban")} · largest servers first`,
    "Names and reasons need mutual opt-in · /settings",
  ];
  addSubtextBlock(container, scopeLines.join("\n"));

  // Falls back to the first page when the paginator wiring hasn't supplied
  // a slice yet — see `ModViewTabContentOptions.lookupPageBans`.
  const pageBans =
    options.lookupPageBans ??
    chunkLookupBans(crossServerBans, currentGuildLookupOptIn)[0] ??
    [];

  if (pageBans.length === 0) {
    // `crossServerBans.length > 0` here (checked above) guarantees
    // `chunkLookupBans`' first page is non-empty, and the paginator wiring
    // clamps `lookupPageBans` to a valid page — this guard is a safety net
    // against `setContent("")` throwing if either invariant ever breaks.
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("**No bans on this page**"),
    );
    return;
  }

  const entriesText = pageBans
    .map((ban) => formatBanEntry(ban, currentGuildLookupOptIn))
    .join("\n");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(entriesText),
  );
};
