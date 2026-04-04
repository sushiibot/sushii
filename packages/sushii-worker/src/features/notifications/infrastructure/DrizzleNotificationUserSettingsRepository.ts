import { inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { notificationUserSettingsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type {
  NotificationUserSettingsRepository,
  UserNotificationSettings,
} from "../domain/repositories/NotificationUserSettingsRepository";

export class DrizzleNotificationUserSettingsRepository
  implements NotificationUserSettingsRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async setIgnoreUnjoinedThreads(
    userId: string,
    value: boolean,
  ): Promise<void> {
    await this.db
      .insert(notificationUserSettingsInAppPublic)
      .values({
        userId: BigInt(userId),
        ignoreUnjoinedThreads: value,
      })
      .onConflictDoUpdate({
        target: notificationUserSettingsInAppPublic.userId,
        set: { ignoreUnjoinedThreads: value },
      });
  }

  async getSettingsForUsers(
    userIds: string[],
  ): Promise<Map<string, UserNotificationSettings>> {
    const rows = await this.db
      .select()
      .from(notificationUserSettingsInAppPublic)
      .where(
        inArray(
          notificationUserSettingsInAppPublic.userId,
          userIds.map((id) => BigInt(id)),
        ),
      );

    const settingsMap = new Map<string, UserNotificationSettings>();

    for (const row of rows) {
      settingsMap.set(row.userId.toString(), {
        ignoreUnjoinedThreads: row.ignoreUnjoinedThreads,
      });
    }

    return settingsMap;
  }
}
