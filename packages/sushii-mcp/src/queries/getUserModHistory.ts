import { and, desc, eq, lt } from "drizzle-orm";

import { modLogsInAppPublic } from "@sushiibot/sushii-worker/schema";

import type { Db } from "../db.ts";

export interface ModCase {
  guildId: string;
  caseId: string;
  action: string;
  actionTime: string;
  userId: string;
  userTag: string;
  executorId: string | null;
  reason: string | null;
  attachments: string[];
}

export async function getUserModHistory(
  db: Db,
  guildId: string,
  userId: string,
  limit: number,
  beforeCaseId?: string,
): Promise<ModCase[]> {
  // No pending filter — old cases may be marked pending=true due to stale data
  // predating the pending system. Match what the sushii /user command shows.
  const conditions = [
    eq(modLogsInAppPublic.guildId, BigInt(guildId)),
    eq(modLogsInAppPublic.userId, BigInt(userId)),
  ];

  if (beforeCaseId !== undefined) {
    conditions.push(lt(modLogsInAppPublic.caseId, BigInt(beforeCaseId)));
  }

  const rows = await db
    .select({
      guildId: modLogsInAppPublic.guildId,
      caseId: modLogsInAppPublic.caseId,
      action: modLogsInAppPublic.action,
      actionTime: modLogsInAppPublic.actionTime,
      userId: modLogsInAppPublic.userId,
      userTag: modLogsInAppPublic.userTag,
      executorId: modLogsInAppPublic.executorId,
      reason: modLogsInAppPublic.reason,
      attachments: modLogsInAppPublic.attachments,
    })
    .from(modLogsInAppPublic)
    .where(and(...conditions))
    .orderBy(desc(modLogsInAppPublic.caseId))
    .limit(limit);

  return rows.map((row) => ({
    guildId: row.guildId.toString(),
    caseId: row.caseId.toString(),
    action: row.action,
    actionTime: row.actionTime.toISOString(),
    userId: row.userId.toString(),
    userTag: row.userTag,
    executorId: row.executorId?.toString() ?? null,
    reason: row.reason,
    attachments: row.attachments,
  }));
}
