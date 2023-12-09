import dayjs from "dayjs";
import { Duration } from "dayjs/plugin/duration";
import parse from "parse-duration";

/**
 * Parses a human string duration as a day.js Duration.
 *
 * @param s string duration
 * @returns Duration or null if invalid duration.
 */
export default function parseDuration(s: string): Duration | null {
  const seconds = parse(s, "s");

  if (!seconds || seconds === 0) {
    return null;
  }

  return dayjs.duration(seconds, "seconds");
}
