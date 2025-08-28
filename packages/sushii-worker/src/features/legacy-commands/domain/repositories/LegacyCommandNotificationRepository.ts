import type { LegacyCommandNotification } from "../entities/LegacyCommandNotification";

export interface LegacyCommandNotificationRepository {
  findByUserId(userId: string): Promise<LegacyCommandNotification | null>;
  save(notification: LegacyCommandNotification): Promise<void>;
}
