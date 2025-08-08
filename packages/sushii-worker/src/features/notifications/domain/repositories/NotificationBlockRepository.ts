import type { NotificationBlock } from "../entities/NotificationBlock";

export interface NotificationBlockRepository {
  add(block: NotificationBlock): Promise<boolean>;
  findByUser(userId: string): Promise<NotificationBlock[]>;
  delete(userId: string, blockId: string): Promise<NotificationBlock | null>;
}
