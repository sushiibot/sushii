const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const MENTION = /<(?:@[!&]?|#)\d+>/g;
// Keycap emoji contain a real digit, so they go before the letter/digit check.
const KEYCAP = /[0-9#*]️?⃣/gu;
// Emoji, whitespace, punctuation and symbols all fall outside this class, so they need no separate pass.
const JUDGEABLE = /[\p{Alphabetic}\p{N}]/u;

/** True when only emoji, mentions, whitespace and punctuation are left. URLs count as content. */
export function isTrivialMessage(content: string): boolean {
  const stripped = content
    .normalize("NFKC")
    .replace(CUSTOM_EMOJI, " ")
    .replace(MENTION, " ")
    .replace(KEYCAP, " ");
  return !JUDGEABLE.test(stripped);
}
