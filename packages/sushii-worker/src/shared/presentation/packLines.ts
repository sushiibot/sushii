/**
 * Per-Text-Display budget shared by every mod view tab and the standalone views
 * they render through.
 *
 * Derived per-component, not message-wide: 4000 (Discord's Text Display cap)
 * minus ~40 for an overflow line appended to the same component, minus slack.
 */
export const TAB_CONTENT_CHAR_BUDGET = 3600;

/** Length a rendered entry costs once joined with "\n". */
function entryCost(rendered: string, isFirst: boolean): number {
  return isFirst ? rendered.length : rendered.length + 1;
}

export interface PackItemsOptions {
  budget?: number;
  /** Noun for the overflow line: `-# +{N} more {noun}`. */
  noun: string;
}

export interface PackItemsResult {
  text: string;
  shown: number;
  overflowLine: string | null;
}

/**
 * Truncating pack: fills one Text Display and drops the tail, reporting how
 * many were dropped. For bounded screens only — a paginated screen must not
 * drop anything, use {@link chunkItems}.
 *
 * A rendered entry is kept whole with its `>` continuation lines; it is never
 * split. An entry that alone exceeds the budget is still emitted when it is
 * first, so the result is never empty for a non-empty input.
 */
export function packItems<T>(
  items: readonly T[],
  render: (item: T) => string,
  opts: PackItemsOptions,
): PackItemsResult {
  const budget = opts.budget ?? TAB_CONTENT_CHAR_BUDGET;

  const kept: string[] = [];
  let used = 0;

  for (const item of items) {
    const rendered = render(item);
    const cost = entryCost(rendered, kept.length === 0);

    // Always take the first entry, even oversized, so the screen is never blank.
    if (kept.length > 0 && used + cost > budget) {
      break;
    }

    kept.push(rendered);
    used += cost;
  }

  const dropped = items.length - kept.length;

  return {
    text: kept.join("\n"),
    shown: kept.length,
    overflowLine: dropped > 0 ? `-# +${dropped} more ${opts.noun}` : null,
  };
}

/**
 * Bin-packing pack: distributes items across as many bins as needed, dropping
 * nothing and returning no overflow line. For paginated screens.
 *
 * Generic over items rather than strings because callers page over the objects
 * themselves — `buildHistoryPages` returns `ModerationCase[][]` and the
 * paginator's `fetchPage`/`renderContainer` consume the case objects.
 *
 * An item that alone exceeds the budget gets its own bin rather than looping.
 */
export function chunkItems<T>(
  items: readonly T[],
  render: (item: T) => string,
  budget: number = TAB_CONTENT_CHAR_BUDGET,
): T[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  let current: T[] = [];
  let used = 0;

  for (const item of items) {
    const rendered = render(item);

    if (current.length > 0 && used + entryCost(rendered, false) > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }

    used += entryCost(rendered, current.length === 0);
    current.push(item);
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
