import type { AltIdentity } from "../entities/AltIdentity";
import type { AltIdentityMember } from "../entities/AltIdentityMember";

/**
 * An identity together with every account currently linked to it.
 */
export interface AltIdentityWithMembers {
  identity: AltIdentity;
  members: AltIdentityMember[];
}

/**
 * Lightweight row for `/alts list` — nickname, member count, and member IDs
 * (so a mod can jump to `/alts view` on one of them), no per-member link
 * metadata.
 */
export interface AltIdentitySummary {
  id: number;
  guildId: string;
  nickname: string | null;
  memberCount: number;
  memberIds: string[];
}
