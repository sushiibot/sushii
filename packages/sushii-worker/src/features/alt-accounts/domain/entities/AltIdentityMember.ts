export interface AltIdentityMemberData {
  identityId: number;
  guildId: string;
  userId: string;
  linkedBy: string;
  linkedAt: Date;
  reason: string | null;
}

export class AltIdentityMember {
  constructor(
    readonly identityId: number,
    readonly guildId: string,
    readonly userId: string,
    readonly linkedBy: string,
    readonly linkedAt: Date,
    readonly reason: string | null,
  ) {}

  static fromData(data: AltIdentityMemberData): AltIdentityMember {
    return new AltIdentityMember(
      data.identityId,
      data.guildId,
      data.userId,
      data.linkedBy,
      data.linkedAt,
      data.reason,
    );
  }
}
