import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";

import type {
  LegacyCommandNotification,
  LegacyCommandNotificationRepository,
} from "../domain";
import { LegacyCommandNotification as LegacyCommandNotificationEntity } from "../domain";

type DbType = NodePgDatabase<typeof schema>;

export class DrizzleLegacyCommandNotificationRepository
  implements LegacyCommandNotificationRepository
{
  constructor(
    private readonly db: DbType,
    private readonly logger: Logger,
  ) {}

  async findByUserId(
    userId: string,
  ): Promise<LegacyCommandNotification | null> {
    const result = await this.db
      .select()
      .from(schema.legacyCommandNotificationsInAppPublic)
      .where(
        eq(schema.legacyCommandNotificationsInAppPublic.userId, BigInt(userId)),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return LegacyCommandNotificationEntity.fromData({
      userId: row.userId.toString(),
      lastDmSent: row.lastDmSent,
      dmCount: row.dmCount,
    });
  }

  async save(notification: LegacyCommandNotification): Promise<void> {
    const data = notification.toData();

    await this.db
      .insert(schema.legacyCommandNotificationsInAppPublic)
      .values({
        userId: BigInt(data.userId),
        lastDmSent: data.lastDmSent,
        dmCount: data.dmCount,
      })
      .onConflictDoUpdate({
        target: schema.legacyCommandNotificationsInAppPublic.userId,
        set: {
          lastDmSent: data.lastDmSent,
          dmCount: data.dmCount,
        },
      });

    this.logger.debug(
      { userId: data.userId, dmCount: data.dmCount },
      "Legacy command notification saved",
    );
  }
}
