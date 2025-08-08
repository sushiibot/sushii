import type { Insertable, Selectable, Updateable } from "kysely";
import type { AppPublicMessages } from "../../infrastructure/database/dbTypes";

export type MessageRow = Selectable<AppPublicMessages>;
export type InsertableMessageRow = Insertable<AppPublicMessages>;
export type UpdateableMessageRow = Updateable<AppPublicMessages>;
