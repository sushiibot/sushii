/**
 * Simple `-s`/`-ies` pluralization for the count+noun phrases mod view (and
 * other Text Display views) render — not a general English inflection
 * engine, just enough to cover the nouns actually used (`case`, `account`,
 * `ban`, `role`, `name change`, …). Add an explicit irregular below rather
 * than growing this into something general-purpose.
 */
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  identity: "identities",
};

export function pluralizeNoun(noun: string, count: number): string {
  if (count === 1) {
    return noun;
  }

  const irregular = IRREGULAR_PLURALS[noun];
  if (irregular) {
    return irregular;
  }

  if (noun.endsWith("y") && !/[aeiou]y$/i.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }

  return `${noun}s`;
}

/** `${count} ${noun}` with the noun's form agreeing with `count`. */
export function countWithNoun(count: number, noun: string): string {
  return `${count} ${pluralizeNoun(noun, count)}`;
}

/**
 * `-# +{N} more {noun}` — the one place this overflow-line literal is built.
 * `noun` is singular; pluralized here to agree with `count`.
 */
export function formatOverflowLine(count: number, noun: string): string {
  return `-# +${count} more ${pluralizeNoun(noun, count)}`;
}
