export const ELLIPSIS = "…";

/** Cuts to at most maxLength UTF-16 units without splitting a code point. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, Math.max(0, maxLength));
  }

  let cut = "";
  for (const char of text) {
    if (cut.length + char.length > maxLength - ELLIPSIS.length) {
      break;
    }
    cut += char;
  }

  return cut.trimEnd() + ELLIPSIS;
}
