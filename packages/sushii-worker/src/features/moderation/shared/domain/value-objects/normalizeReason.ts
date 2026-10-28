/** Lowercased, trimmed, whitespace collapsed. Used to compare reasons. */
export function normalizeReason(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
