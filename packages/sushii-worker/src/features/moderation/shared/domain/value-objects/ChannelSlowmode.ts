import plugin from "dayjs/plugin/duration";
import { Err, Ok, Result } from "ts-results";

import dayjs from "@/shared/domain/dayjs";
import parseDuration from "@/utils/parseDuration";

const RE_ONLY_NUMBERS = /^\d+$/;
const MAX_SLOWMODE_SECONDS = 21600; // 6 hours

export class ChannelSlowmode {
  private constructor(private readonly seconds: number) {}

  static fromString(durationStr: string): Result<ChannelSlowmode, string> {
    const trimmed = durationStr.trim();

    if (!trimmed) {
      return Err("Duration cannot be empty");
    }

    const isUnitless = RE_ONLY_NUMBERS.test(trimmed);

    let duration: plugin.Duration | null = null;
    if (isUnitless) {
      duration = dayjs.duration({
        seconds: parseInt(trimmed, 10),
      });
    } else {
      duration = parseDuration(trimmed);
    }

    if (!duration) {
      return Err(
        "Invalid duration format. Please use a valid duration like 5s or 1m",
      );
    }

    const seconds = Math.floor(duration.asSeconds());

    if (seconds < 0) {
      return Err("Duration cannot be negative");
    }

    if (seconds > MAX_SLOWMODE_SECONDS) {
      return Err("Slowmode must be less than 6 hours");
    }

    return Ok(new ChannelSlowmode(seconds));
  }

  static fromSeconds(seconds: number): Result<ChannelSlowmode, string> {
    if (seconds < 0) {
      return Err("Duration cannot be negative");
    }

    if (seconds > MAX_SLOWMODE_SECONDS) {
      return Err("Slowmode must be less than 6 hours");
    }

    return Ok(new ChannelSlowmode(Math.floor(seconds)));
  }

  get asSeconds(): number {
    return this.seconds;
  }

  get isDisabled(): boolean {
    return this.seconds === 0;
  }

  formatDuration(): string {
    if (this.seconds === 0) {
      return "Disabled";
    }

    const duration = dayjs.duration({ seconds: this.seconds });
    const parts: string[] = [];

    const hours = duration.hours();
    const minutes = duration.minutes();
    const seconds = duration.seconds();

    if (hours > 0) {
      parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
    }

    if (minutes > 0) {
      parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
    }

    if (seconds > 0) {
      parts.push(`${seconds} second${seconds > 1 ? "s" : ""}`);
    }

    return parts.join(" ");
  }

  toString(): string {
    return this.formatDuration();
  }
}
