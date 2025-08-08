import type { Duration as DayjsDuration } from "dayjs/plugin/duration";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import dayjs from "@/shared/domain/dayjs";
import parseDuration from "@/utils/parseDuration";

export class Duration {
  private constructor(
    private readonly _value: DayjsDuration,
    private readonly _originalString: string,
  ) {}

  static create(
    durationString: string | null,
  ): Result<Duration | null, string> {
    if (!durationString) {
      return Ok(null);
    }

    const parsedDuration = parseDuration(durationString);
    if (!parsedDuration) {
      return Err(
        "Invalid duration! Please use a valid duration such as 1d, 6h, etc.",
      );
    }

    return Ok(new Duration(parsedDuration, durationString));
  }

  get value(): DayjsDuration {
    return this._value;
  }

  get originalString(): string {
    return this._originalString;
  }

  endTime(): dayjs.Dayjs {
    return dayjs.utc().add(this._value);
  }

  toString(): string {
    return this._originalString;
  }

  asSeconds(): number {
    return Math.floor(this._value.asSeconds());
  }
}
