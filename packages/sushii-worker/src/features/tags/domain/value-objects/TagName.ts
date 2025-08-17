import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const VALID_TAG_NAME_REGEX = /^[a-z0-9_-]+$/i;

const tagNameSchema = z
  .string()
  .trim()
  .min(1, {
    message: "Tag name is too short. Tag names must be 1 character or more.",
  })
  .max(32, {
    message: "Tag name is too long. Tag names must be 32 characters or less.",
  })
  .regex(VALID_TAG_NAME_REGEX, {
    message:
      "Tag name contains invalid characters. Only lowercase letters, numbers, and symbols _ and -",
  });

export class TagName {
  private constructor(private readonly value: string) {}

  static create(value: string): Result<TagName, string> {
    const normalizedValue = value.toLowerCase().trim();
    const res = tagNameSchema.safeParse(normalizedValue);

    if (!res.success) {
      const err = fromZodError(res.error, {
        prefix: null,
      });
      return Err(err.message);
    }

    return Ok(new TagName(res.data));
  }

  static createFromDatabase(value: string): TagName {
    // For database reads - accepts legacy formats without validation
    // This allows us to read legacy tags without crashing
    return new TagName(value);
  }

  static normalize(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_") // spaces to underscores
      .replace(/[^a-z0-9_-]/g, "") // remove special chars
      .replace(/_{2,}/g, "_") // collapse multiple underscores
      .replace(/-{2,}/g, "-") // collapse multiple hyphens
      .slice(0, 32); // enforce max length
  }

  getValue(): string {
    return this.value;
  }

  equals(other: TagName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
