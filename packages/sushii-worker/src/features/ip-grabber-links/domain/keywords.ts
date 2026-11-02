export const MAX_RULE_KEYWORDS = 1000;
const MAX_KEYWORD_LENGTH = 60;

/**
 * Keywords without wildcards only match when surrounded by whitespace, so a
 * plain domain would never match inside a URL.
 */
export function toKeyword(hostname: string): string | null {
  const keyword = `*${hostname.toLowerCase()}*`;
  return keyword.length <= MAX_KEYWORD_LENGTH ? keyword : null;
}

export function toKeywords(hostnames: Iterable<string>): string[] {
  const keywords = new Set<string>();
  for (const hostname of hostnames) {
    const keyword = toKeyword(hostname);
    if (keyword) {
      keywords.add(keyword);
    }
  }

  return [...keywords].sort();
}

export interface KeywordMerge {
  /** The full keyword list to write to the rule. */
  next: string[];
  /** The keywords sushii owns in `next`. */
  managed: string[];
  changed: boolean;
}

/**
 * Keywords sushii didn't add belong to the server and are kept as they are.
 * A desired keyword the server already had stays theirs, so turning the
 * feature off never removes it. Discord matches case-insensitively.
 */
export function mergeKeywords(input: {
  ruleKeywords: readonly string[];
  previouslyManaged: readonly string[];
  desired: readonly string[];
}): KeywordMerge {
  const previous = new Set(input.previouslyManaged.map((k) => k.toLowerCase()));
  const serverOwned = input.ruleKeywords.filter(
    (k) => !previous.has(k.toLowerCase()),
  );
  const serverOwnedLower = new Set(serverOwned.map((k) => k.toLowerCase()));

  const managed: string[] = [];
  const seen = new Set<string>();
  for (const keyword of input.desired) {
    const lower = keyword.toLowerCase();
    if (serverOwnedLower.has(lower) || seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    managed.push(keyword);
  }

  const next = [...serverOwned, ...managed];
  const current = new Set(input.ruleKeywords);
  const changed =
    next.length !== current.size || next.some((k) => !current.has(k));

  return { next, managed, changed };
}
