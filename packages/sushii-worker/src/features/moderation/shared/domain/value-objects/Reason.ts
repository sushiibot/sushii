import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

// Leaves room for surrounding text so every view can show the full reason uncut.
export const REASON_MAX_LENGTH = 3000;

export class Reason {
  private constructor(private readonly _value: string) {}

  static create(value: string | null): Result<Reason | null, string> {
    if (!value) {
      return Ok(null);
    }

    if (value.length > REASON_MAX_LENGTH) {
      return Err(
        `Reason must be ${REASON_MAX_LENGTH} characters or less (got ${value.length})`,
      );
    }

    return Ok(new Reason(value));
  }

  get value(): string {
    return this._value;
  }

  toString(): string {
    return this._value;
  }
}
