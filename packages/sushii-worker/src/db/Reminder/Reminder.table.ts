import type { Insertable, Selectable, Updateable } from "kysely";
import type { AppPublicReminders } from "../../infrastructure/database/dbTypes";

export type ReminderRow = Selectable<AppPublicReminders>;
export type InsertableReminderRow = Insertable<AppPublicReminders>;
export type UpdateableReminderRow = Updateable<AppPublicReminders>;
