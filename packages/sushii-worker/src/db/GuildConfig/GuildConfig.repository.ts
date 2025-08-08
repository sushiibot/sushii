import type { Kysely } from "kysely";
import opentelemetry from "@opentelemetry/api";
import type { UpdateObjectExpression } from "kysely/dist/cjs/parser/update-set-parser";
import type { GuildConfigRow } from "./GuildConfig.table";
import type { DB } from "../../infrastructure/database/dbTypes";
import { json } from "../../infrastructure/database/json";

const tracer = opentelemetry.trace.getTracer("GuildConfig.repository");

const defaultGuildConfig: GuildConfigRow = {
  id: "0",
  prefix: null,
  join_msg: null,
  join_msg_enabled: true,
  join_react: null,
  leave_msg: null,
  leave_msg_enabled: true,
  msg_channel: null,
  role_channel: null,
  role_config: null,
  role_enabled: true,
  log_msg: null,
  log_msg_enabled: true,
  log_mod: null,
  log_mod_enabled: true,
  log_member: null,
  log_member_enabled: true,
  mute_dm_text: null,
  mute_dm_enabled: true,
  warn_dm_text: null,
  warn_dm_enabled: true,
  disabled_channels: null,
  lookup_prompted: false,
  lookup_details_opt_in: false,
  data: {},
};

/**
 * Gets a guild config or returns a default one if it doesn't exist.
 *
 * @param db
 * @param guildId
 * @returns
 */
export async function getGuildConfig(
  db: Kysely<DB>,
  guildId: string,
): Promise<GuildConfigRow> {
  const span = tracer.startSpan("getGuildConfig");

  try {
    const conf = await db
      .selectFrom("app_public.guild_configs")
      .selectAll()
      .where("id", "=", guildId)
      .executeTakeFirst();

    if (conf) {
      return conf;
    }

    return {
      ...defaultGuildConfig,
      id: guildId,
    };
  } finally {
    span.end();
  }
}

/**
 * Upserts a guild config.
 *
 * @param db
 * @param guildConfig
 * @returns
 */
export async function upsertGuildConfig(
  db: Kysely<DB>,
  guildConfig: GuildConfigRow,
): Promise<GuildConfigRow> {
  return db
    .insertInto("app_public.guild_configs")
    .values({
      ...guildConfig,
      data: json(guildConfig.data),
      role_config: json(guildConfig.role_config),
    })
    .returningAll()
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        ...guildConfig,
        data: json(guildConfig.data),
        role_config: json(guildConfig.role_config),
      }),
    )
    .executeTakeFirstOrThrow();
}

export async function updateGuildConfigColumn(
  db: Kysely<DB>,
  guildId: string,
  patch: UpdateObjectExpression<DB, "app_public.guild_configs">,
): Promise<GuildConfigRow> {
  return db
    .insertInto("app_public.guild_configs")
    .values({
      id: guildId,
      ...patch,
    })
    .returningAll()
    .onConflict((oc) => oc.column("id").doUpdateSet(patch))
    .executeTakeFirstOrThrow();
}
