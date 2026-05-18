import { desc, eq } from "drizzle-orm";

import { modLogsInAppPublic } from "@sushiibot/sushii-worker/schema";

import type { Db } from "../db.ts";

import type { ModCase } from "./getUserModHistory.ts";

export async function getGuildRecentCases(
  db: Db,
  guildId: string,
  limit: number,
): Promise<ModCase[]> {
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
    .where(eq(modLogsInAppPublic.guildId, BigInt(guildId)))
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
