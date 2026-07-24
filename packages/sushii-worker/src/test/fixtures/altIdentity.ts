import { AltIdentity } from "@/features/alt-accounts/domain/entities/AltIdentity";
import { AltIdentityMember } from "@/features/alt-accounts/domain/entities/AltIdentityMember";
import type { AltIdentityWithMembers } from "@/features/alt-accounts/domain/types";

export interface MakeAltIdentityOptions {
  id?: number;
  guildId?: string;
  nickname?: string | null;
  /** Member user IDs to attach; defaults to none. */
  memberIds?: string[];
  linkedBy?: string;
}

export function makeAltIdentity(
  options: MakeAltIdentityOptions = {},
): AltIdentityWithMembers {
  const id = options.id ?? 1;
  const guildId = options.guildId ?? "111111111111111111";
  const linkedBy = options.linkedBy ?? "444444444444444444";

  return {
    identity: AltIdentity.fromData({
      id,
      guildId,
      nickname: options.nickname ?? null,
      createdAt: new Date(),
    }),
    members: (options.memberIds ?? []).map((userId) =>
      AltIdentityMember.fromData({
        identityId: id,
        guildId,
        userId,
        linkedBy,
        linkedAt: new Date(),
        reason: null,
      }),
    ),
  };
}
