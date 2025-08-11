export interface GiveawayEntryData {
  giveawayId: string;
  userId: string;
  createdAt: Date;
  isPicked: boolean;
}

export class GiveawayEntry {
  constructor(private readonly data: GiveawayEntryData) {}

  get giveawayId(): string {
    return this.data.giveawayId;
  }

  get userId(): string {
    return this.data.userId;
  }

  get createdAt(): Date {
    return this.data.createdAt;
  }

  get isPicked(): boolean {
    return this.data.isPicked;
  }

  markAsPicked(): GiveawayEntry {
    return new GiveawayEntry({
      ...this.data,
      isPicked: true,
    });
  }

  toData(): GiveawayEntryData {
    return { ...this.data };
  }

  static fromData(data: GiveawayEntryData): GiveawayEntry {
    return new GiveawayEntry(data);
  }

  static create(giveawayId: string, userId: string): GiveawayEntry {
    return new GiveawayEntry({
      giveawayId,
      userId,
      createdAt: new Date(),
      isPicked: false,
    });
  }
}
