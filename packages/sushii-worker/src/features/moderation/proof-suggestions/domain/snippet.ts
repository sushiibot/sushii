import { escapeMarkdown } from "discord.js";

import { SNIPPET_MAX_LENGTH } from "./ProofSuggestion";

export function toSnippet(text: string, max = SNIPPET_MAX_LENGTH): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length === 0) {
    return "";
  }

  // Escaping can grow the text, so shrink the raw slice until the escaped form fits.
  let take = Math.min(chars.length, max);
  for (;;) {
    const truncated = take < chars.length;
    const raw = chars.slice(0, take).join("");
    const escaped = escapeMarkdown(raw) + (truncated ? "…" : "");
    if (Array.from(escaped).length <= max || take <= 1) {
      return Array.from(escaped).slice(0, max).join("");
    }

    take -= 1;
  }
}
