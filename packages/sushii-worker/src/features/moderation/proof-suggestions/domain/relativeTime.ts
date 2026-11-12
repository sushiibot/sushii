function offset(at: Date, actionTime: Date): string {
  const ms = actionTime.getTime() - at.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError("Invalid preview time");
  }
  if (ms < 0) {
    return "after";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) {
    return "just before";
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export function relativeTimeRange(
  first: Date,
  last: Date,
  actionTime: Date,
): string {
  const a = offset(first, actionTime);
  const b = offset(last, actionTime);
  const label = (value: string) =>
    value === "after" || value === "just before" ? value : `${value} before`;
  if (a === b) {
    return label(a);
  }
  if (a === "after" || b === "after") {
    return `${label(a)}–${label(b)}`;
  }
  if (b === "just before") {
    return `in the ${a} before`;
  }
  const sameUnit = a.slice(-1) === b.slice(-1);
  return `${sameUnit ? a.slice(0, -1) : a}–${b} before`;
}
