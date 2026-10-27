/** Cuts by code point so emoji and other astral characters are never split. */
export function truncateCodePoints(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}
