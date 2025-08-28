export interface LegacyCommandNotificationData {
  userId: string;
  lastDmSent: Date;
  dmCount: number;
}

export class LegacyCommandNotification {
  constructor(
    public readonly userId: string,
    public readonly lastDmSent: Date,
    public readonly dmCount: number,
  ) {}

  static fromData(
    data: LegacyCommandNotificationData,
  ): LegacyCommandNotification {
    return new LegacyCommandNotification(
      data.userId,
      data.lastDmSent,
      data.dmCount,
    );
  }

  toData(): LegacyCommandNotificationData {
    return {
      userId: this.userId,
      lastDmSent: this.lastDmSent,
      dmCount: this.dmCount,
    };
  }

  canSendNotification(): boolean {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return this.lastDmSent < oneWeekAgo;
  }

  withNewNotification(): LegacyCommandNotification {
    return new LegacyCommandNotification(
      this.userId,
      new Date(),
      this.dmCount + 1,
    );
  }
}
