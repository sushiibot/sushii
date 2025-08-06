import dayjs from "@/shared/domain/dayjs";

type Dayjs = ReturnType<typeof dayjs>;

export class TempBan {
  constructor(
    private readonly _userId: string,
    private readonly _guildId: string,
    private readonly _expiresAt: Dayjs,
    private readonly _createdAt: Dayjs = dayjs.utc(),
  ) {}

  static create(userId: string, guildId: string, expiresAt: Dayjs): TempBan {
    if (!userId || !guildId) {
      throw new Error("User ID and Guild ID are required");
    }

    if (!expiresAt.isValid()) {
      throw new Error("Invalid expiration date");
    }

    if (expiresAt.isBefore(dayjs.utc())) {
      throw new Error("Expiration date must be in the future");
    }

    return new TempBan(userId, guildId, expiresAt);
  }

  static fromDatabase(
    userId: string,
    guildId: string,
    expiresAt: string | Date,
    createdAt: string | Date,
  ): TempBan {
    return new TempBan(
      userId,
      guildId,
      dayjs.utc(expiresAt),
      dayjs.utc(createdAt),
    );
  }

  get userId(): string {
    return this._userId;
  }

  get guildId(): string {
    return this._guildId;
  }

  get expiresAt(): Dayjs {
    return this._expiresAt;
  }

  get createdAt(): Dayjs {
    return this._createdAt;
  }

  isExpired(): boolean {
    return this._expiresAt.isBefore(dayjs.utc());
  }

  getRemainingTime(): Dayjs | null {
    if (this.isExpired()) {
      return null;
    }
    return this._expiresAt;
  }

  getRemainingDuration(): string {
    if (this.isExpired()) {
      return "Expired";
    }
    return this._expiresAt.fromNow();
  }

  getExpirationTimestamp(): number {
    return Math.floor(this._expiresAt.unix());
  }

  getCreatedTimestamp(): number {
    return Math.floor(this._createdAt.unix());
  }

  toDatabase() {
    return {
      userId: this._userId,
      guildId: this._guildId,
      expiresAt: this._expiresAt.toDate(),
      createdAt: this._createdAt.toDate(),
    };
  }

  equals(other: TempBan): boolean {
    return this._userId === other._userId && this._guildId === other._guildId;
  }
}
