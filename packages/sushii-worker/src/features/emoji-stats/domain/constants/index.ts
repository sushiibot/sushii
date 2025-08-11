import dayjs from "@/shared/domain/dayjs";

export const EMOJI_RE = /<(?<animated>a)?:(?<name>\w+):(?<id>\d{16,21})>/g;
export const USER_EMOJI_RATE_LIMIT_DURATION = dayjs.duration({ hours: 1 });