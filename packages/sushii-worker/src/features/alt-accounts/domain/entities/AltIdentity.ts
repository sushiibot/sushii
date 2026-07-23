export interface AltIdentityData {
  id: number;
  guildId: string;
  nickname: string | null;
  createdAt: Date;
}

export class AltIdentity {
  constructor(
    readonly id: number,
    readonly guildId: string,
    readonly nickname: string | null,
    readonly createdAt: Date,
  ) {}

  static fromData(data: AltIdentityData): AltIdentity {
    return new AltIdentity(
      data.id,
      data.guildId,
      data.nickname,
      data.createdAt,
    );
  }
}
