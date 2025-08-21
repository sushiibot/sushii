import type { Reminder } from "../entities/Reminder";

export interface ReminderRepository {
  save(reminder: Reminder): Promise<void>;
  findByUserIdAndId(userId: string, id: string): Promise<Reminder | null>;
  findByUserId(userId: string): Promise<Reminder[]>;
  findExpired(): Promise<Reminder[]>;
  deleteByUserIdAndId(userId: string, id: string): Promise<Reminder | null>;
  deleteExpired(): Promise<Reminder[]>;
  countPending(): Promise<number>;
  findForAutocomplete(userId: string, query: string): Promise<Reminder[]>;
}