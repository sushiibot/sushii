// Cross-server ban query mirrors DrizzleUserLookupRepository.getUserCrossServerBans()
// in packages/sushii-worker/src/features/moderation/cases/infrastructure/repositories/DrizzleUserLookupRepository.ts
// If that query changes (e.g., new opt-out filters), update this file as well.
import { and, desc, eq } from "drizzle-orm";

import {
  cachedGuildsInAppPublic,
  guildBansInAppPublic,
  guildConfigsInAppPublic,
  modLogsInAppPublic,
} from "@sushiibot/sushii-worker/schema";

import type { Db } from "../db.ts";

export interface CrossServerBan {
  guildId: string;
  guildName: string | null;
  guildMembers: number;
  reason: string | null;
  actionTime: string | null;
  lookupDetailsOptIn: boolean;
}

export async function getUserCrossServerBans(
  db: Db,
  userId: string,
): Promise<CrossServerBan[]> {
  const rows = await db
    .selectDistinctOn([guildBansInAppPublic.guildId], {
      guildId: guildBansInAppPublic.guildId,
      reason: modLogsInAppPublic.reason,
      actionTime: modLogsInAppPublic.actionTime,
      lookupDetailsOptIn: guildConfigsInAppPublic.lookupDetailsOptIn,
      guildName: cachedGuildsInAppPublic.name,
      memberCount: cachedGuildsInAppPublic.memberCount,
    })
    .from(guildBansInAppPublic)
    .leftJoin(
      modLogsInAppPublic,
      and(
        eq(guildBansInAppPublic.guildId, modLogsInAppPublic.guildId),
        eq(guildBansInAppPublic.userId, modLogsInAppPublic.userId),
        eq(modLogsInAppPublic.action, "ban"),
      ),
    )
    .leftJoin(
      guildConfigsInAppPublic,
      eq(guildConfigsInAppPublic.id, guildBansInAppPublic.guildId),
    )
    .leftJoin(
      cachedGuildsInAppPublic,
      eq(cachedGuildsInAppPublic.id, guildBansInAppPublic.guildId),
    )
    .where(eq(guildBansInAppPublic.userId, BigInt(userId)))
    .orderBy(desc(guildBansInAppPublic.guildId))
    .limit(500);

  return rows.map((row) => {
    const optIn = row.lookupDetailsOptIn ?? false;
    return {
      guildId: row.guildId.toString(),
      guildName: optIn ? (row.guildName ?? null) : "[redacted]",
      guildMembers: row.memberCount ? Number(row.memberCount) : 0,
      reason: optIn ? (row.reason ?? null) : null,
      actionTime: row.actionTime ? row.actionTime.toISOString() : null,
      lookupDetailsOptIn: optIn,
    };
  });
}
