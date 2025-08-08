import type { TimestampStylesString } from "discord.js";
import { TimestampStyles } from "discord.js";

import type dayjs from "@/shared/domain/dayjs";

export default function toTimestamp(
  date: dayjs.Dayjs,
  style: TimestampStylesString = TimestampStyles.ShortDateTime,
): string {
  return `<t:${date.unix()}:${style}>`;
}
