import type { Reminder } from "../entities/Reminder";

export interface ReminderRepository {
  save(reminder: Reminder): Promise<Reminder>;
  findByUserIdAndId(userId: string, id: string): Promise<Reminder | null>;
  findByUserId(userId: string): Promise<Reminder[]>;
  findByUserIdPaginated(
    userId: string,
    offset: number,
    limit: number,
  ): Promise<Reminder[]>;
  countByUserId(userId: string): Promise<number>;
  findExpired(): Promise<Reminder[]>;
  deleteByUserIdAndId(userId: string, id: string): Promise<Reminder | null>;
  countPending(): Promise<number>;
  findForAutocomplete(userId: string, query: string): Promise<Reminder[]>;
}
