import type { Duration } from "dayjs/plugin/duration";

import dayjs from "@/shared/domain/dayjs";

import parseDuration from "./parseDuration";

const TIMESTAMP_RE = /<t:(\d{10,}):\w>/;

function parseDurationFromTimestamp(timestamp: string): Duration | null {
  const tsMatch = timestamp.match(TIMESTAMP_RE);

  if (!tsMatch) {
    return null;
  }

  if (tsMatch.length !== 2) {
    return null;
  }

  // Discord timestamps are in seconds
  const duratonMs = parseInt(tsMatch[1], 10);

  const durationTimestamp = dayjs.unix(duratonMs);
  if (!durationTimestamp.isValid()) {
    return null;
  }

  // In past
  if (durationTimestamp.isBefore(dayjs.utc())) {
    return null;
  }

  return dayjs.duration(durationTimestamp.diff(dayjs.utc()));
}

export default function parseDurationOrTimestamp(str: string): Duration | null {
  if (str.startsWith("<t:")) {
    return parseDurationFromTimestamp(str);
  }

  return parseDuration(str);
}
