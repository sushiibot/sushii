import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

export class Reason {
  private constructor(private readonly _value: string) {}

  static create(value: string | null): Result<Reason | null, string> {
    if (!value) {
      return Ok(null);
    }

    if (value.length > 1024) {
      return Err("Reason must be less than 1024 characters");
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
