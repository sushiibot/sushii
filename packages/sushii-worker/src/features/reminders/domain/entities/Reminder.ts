import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

export interface ReminderData {
  id: string;
  userId: string;
  description: string;
  setAt: Date;
  expireAt: Date;
}

export class Reminder {
  private constructor(
    private readonly id: string,
    private readonly userId: string,
    private description: string,
    private readonly setAt: Date,
    private expireAt: Date,
  ) {}

  static create(data: ReminderData): Result<Reminder, string> {
    if (!data.description || data.description.trim().length === 0) {
      return Err("Reminder description cannot be empty");
    }

    if (data.description.length > 500) {
      return Err("Reminder description cannot exceed 500 characters");
    }

    if (data.expireAt <= new Date()) {
      return Err("Reminder expiry time must be in the future");
    }

    return Ok(
      new Reminder(
        data.id,
        data.userId,
        data.description.trim(),
        data.setAt,
        data.expireAt,
      ),
    );
  }

  static createFromDatabase(data: ReminderData): Reminder {
    return new Reminder(
      data.id,
      data.userId,
      data.description,
      data.setAt,
      data.expireAt,
    );
  }

  getId(): string {
    return this.id;
  }

  getUserId(): string {
    return this.userId;
  }

  getDescription(): string {
    return this.description;
  }

  getSetAt(): Date {
    return this.setAt;
  }

  getExpireAt(): Date {
    return this.expireAt;
  }

  updateDescription(newDescription: string): Result<void, string> {
    if (!newDescription || newDescription.trim().length === 0) {
      return Err("Reminder description cannot be empty");
    }

    if (newDescription.length > 500) {
      return Err("Reminder description cannot exceed 500 characters");
    }

    this.description = newDescription.trim();
    return Ok(undefined);
  }

  isExpired(): boolean {
    return this.expireAt <= new Date();
  }

  toData(): ReminderData {
    return {
      id: this.id,
      userId: this.userId,
      description: this.description,
      setAt: this.setAt,
      expireAt: this.expireAt,
    };
  }
}
