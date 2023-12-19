import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import dayOfYear from "dayjs/plugin/dayOfYear";
import weekOfYear from "dayjs/plugin/weekOfYear";

dayjs.extend(utc);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(dayOfYear);
dayjs.extend(weekOfYear);
