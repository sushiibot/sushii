import type { Duration } from "dayjs/plugin/duration";

import dayjs from "@/shared/domain/dayjs";

export default function getDuration(a: dayjs.Dayjs, b: dayjs.Dayjs): Duration {
  const ms = a.diff(b);
  return dayjs.duration({ milliseconds: ms });
}

export function getDurationFromNow(d: dayjs.Dayjs): Duration {
  return getDuration(dayjs.utc(), d);
}
