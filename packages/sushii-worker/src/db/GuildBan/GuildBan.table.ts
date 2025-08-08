import type { Insertable, Selectable, Updateable } from "kysely";
import type { AppPublicGuildBans } from "../../infrastructure/database/dbTypes";

export type GuildBanRow = Selectable<AppPublicGuildBans>;
export type InsertableGuildBanRow = Insertable<AppPublicGuildBans>;
export type UpdateableGuildBanRow = Updateable<AppPublicGuildBans>;
