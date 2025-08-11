import type { Insertable, Selectable, Updateable } from "kysely";

import type { AppPublicGuildConfigs } from "../../infrastructure/database/dbTypes";

export type GuildConfigRow = Selectable<AppPublicGuildConfigs>;
export type InsertableGuildConfigRow = Insertable<AppPublicGuildConfigs>;
export type UpdateableGuildConfigRow = Updateable<AppPublicGuildConfigs>;
