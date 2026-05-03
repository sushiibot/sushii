import { pgTable, pgSchema, text, integer, timestamp, unique, pgPolicy, bigint, boolean, index, jsonb, primaryKey, foreignKey, check, varchar, serial, smallint } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const appHidden = pgSchema("app_hidden");
export const appPrivate = pgSchema("app_private");
export const appPublic = pgSchema("app_public");
export const levelTimeframeInAppHidden = appHidden.enum("level_timeframe", ['ALL_TIME', 'DAY', 'WEEK', 'MONTH'])
export const deploymentNameInAppPrivate = appPrivate.enum("deployment_name", ['blue', 'green'])
export const blockTypeInAppPublic = appPublic.enum("block_type", ['channel', 'role'])
export const emojiStickerActionTypeInAppPublic = appPublic.enum("emoji_sticker_action_type", ['message', 'reaction'])
export const giveawayNitroTypeInAppPublic = appPublic.enum("giveaway_nitro_type", ['none', 'nitro'])
export const guildAssetTypeInAppPublic = appPublic.enum("guild_asset_type", ['emoji', 'sticker'])
export const notificationBlockTypeInAppPublic = appPublic.enum("notification_block_type", ['user', 'channel', 'category'])


export const failuresInAppHidden = appHidden.table("failures", {
	failureId: text("failure_id").primaryKey().notNull(),
	maxAttempts: integer("max_attempts").default(25).notNull(),
	attemptCount: integer("attempt_count").notNull(),
	lastAttempt: timestamp("last_attempt", { mode: 'string' }).notNull(),
	nextAttempt: timestamp("next_attempt", { mode: 'string' }).notNull().generatedAlwaysAs(sql`(last_attempt + (exp((LEAST(10, attempt_count))::double precision) * '00:00:01'::interval))`),
});

export const activeDeploymentInAppPrivate = appPrivate.table("active_deployment", {
	id: integer().notNull().generatedAlwaysAs(sql`1`),
	name: deploymentNameInAppPrivate().notNull(),
}, (table) => [
	unique("active_deployment_id_key").on(table.id),
]);

export const cachedUsersInAppPublic = appPublic.table("cached_users", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	avatarUrl: text("avatar_url").notNull(),
	name: text().notNull(),
	discriminator: integer().notNull(),
	lastChecked: timestamp("last_checked", { mode: 'string' }).notNull(),
}, (table) => [
	pgPolicy("select_all", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const giveawaysInAppPublic = appPublic.table("giveaways", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	hostUserId: bigint("host_user_id", { mode: "number" }).notNull(),
	prize: text().notNull(),
	numWinners: integer("num_winners").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	requiredRoleId: bigint("required_role_id", { mode: "number" }),
	requiredMinLevel: integer("required_min_level"),
	requiredMaxLevel: integer("required_max_level"),
	requiredNitroState: giveawayNitroTypeInAppPublic("required_nitro_state"),
	requiredBoosting: boolean("required_boosting"),
	isEnded: boolean("is_ended").default(false).notNull(),
	startAt: timestamp("start_at", { mode: 'string' }).notNull(),
	endAt: timestamp("end_at", { mode: 'string' }).notNull(),
});

export const guildEmojisAndStickersInAppPublic = appPublic.table("guild_emojis_and_stickers", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	name: text().notNull(),
	type: guildAssetTypeInAppPublic().notNull(),
});

export const messagesInAppPublic = appPublic.table("messages", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	messageId: bigint("message_id", { mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	authorId: bigint("author_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	created: timestamp({ mode: 'string' }).notNull(),
	content: text().notNull(),
	msg: jsonb().notNull(),
}, (table) => [
	index("messages_created_idx").using("btree", table.created.asc().nullsLast().op("timestamp_ops")),
]);

export const usersInAppPublic = appPublic.table("users", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	isPatron: boolean("is_patron").default(false).notNull(),
	patronEmoji: text("patron_emoji"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rep: bigint({ mode: "number" }).default(sql`'0'`).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fishies: bigint({ mode: "number" }).default(sql`'0'`).notNull(),
	lastRep: timestamp("last_rep", { mode: 'string' }),
	lastFishies: timestamp("last_fishies", { mode: 'string' }),
	lastfmUsername: text("lastfm_username"),
	profileData: jsonb("profile_data"),
});

export const botEmojisInAppPublic = appPublic.table("bot_emojis", {
	name: text().primaryKey().notNull(),
	id: text().notNull(),
	sha256: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bot_emojis_name_idx").using("btree", table.name.asc().nullsLast().op("text_ops")),
]);

export const cachedGuildsInAppPublic = appPublic.table("cached_guilds", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	icon: text(),
	splash: text(),
	banner: text(),
	features: text().array().default([""]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	memberCount: bigint("member_count", { mode: "number" }),
}, (table) => [
	pgPolicy("select_all", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const legacyCommandNotificationsInAppPublic = appPublic.table("legacy_command_notifications", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).primaryKey().notNull(),
	lastDmSent: timestamp("last_dm_sent", { mode: 'string' }).notNull(),
	dmCount: integer("dm_count").default(0).notNull(),
}, (table) => [
	index("legacy_command_notifications_last_dm_idx").using("btree", table.lastDmSent.asc().nullsLast().op("timestamp_ops")),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const guildConfigsInAppPublic = appPublic.table("guild_configs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().notNull(),
	prefix: text(),
	joinMsg: text("join_msg"),
	joinMsgEnabled: boolean("join_msg_enabled").default(true).notNull(),
	joinReact: text("join_react"),
	leaveMsg: text("leave_msg"),
	leaveMsgEnabled: boolean("leave_msg_enabled").default(true).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	msgChannel: bigint("msg_channel", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	logMsg: bigint("log_msg", { mode: "number" }),
	logMsgEnabled: boolean("log_msg_enabled").default(true).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	logMod: bigint("log_mod", { mode: "number" }),
	logModEnabled: boolean("log_mod_enabled").default(true).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	logMember: bigint("log_member", { mode: "number" }),
	logMemberEnabled: boolean("log_member_enabled").default(true).notNull(),
	timeoutDmText: text("timeout_dm_text"),
	timeoutDmEnabled: boolean("timeout_dm_enabled").default(true).notNull(),
	warnDmText: text("warn_dm_text"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	disabledChannels: bigint("disabled_channels", { mode: "number" }).array(),
	lookupDetailsOptIn: boolean("lookup_details_opt_in").default(false).notNull(),
	lookupPrompted: boolean("lookup_prompted").default(false).notNull(),
	timeoutNativeDmEnabled: boolean("timeout_native_dm_enabled").default(true).notNull(),
	banDmText: text("ban_dm_text"),
	banDmEnabled: boolean("ban_dm_enabled").default(true).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	logReaction: bigint("log_reaction", { mode: "number" }),
	logReactionEnabled: boolean("log_reaction_enabled").default(true).notNull(),
	automodSpamEnabled: boolean("automod_spam_enabled").default(false).notNull(),
	kickDmText: text("kick_dm_text"),
	kickDmEnabled: boolean("kick_dm_enabled").default(false).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	automodAlertsChannelId: bigint("automod_alerts_channel_id", { mode: "number" }),
}, (table) => [
	pgPolicy("update_managed_guild", { as: "permissive", for: "update", to: ["public"], using: sql`(id IN ( SELECT app_public.current_user_managed_guild_ids() AS current_user_managed_guild_ids))` }),
	pgPolicy("select_managed_guild", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"] }),
]);

export const notificationUserSettingsInAppPublic = appPublic.table("notification_user_settings", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).primaryKey().notNull(),
	ignoreUnjoinedThreads: boolean("ignore_unjoined_threads").default(false).notNull(),
}, (table) => [
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const guildBansInAppPublic = appPublic.table("guild_bans", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
}, (table) => [
	index("guild_bans_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.guildId, table.userId], name: "guild_bans_pkey"}),
]);

export const msgLogBlocksInAppPublic = appPublic.table("msg_log_blocks", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.guildId, table.channelId], name: "msg_log_blocks_pkey"}),
]);

export const membersInAppPublic = appPublic.table("members", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	joinTime: timestamp("join_time", { mode: 'string' }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.guildId, table.userId], name: "members_pkey"}),
]);

export const notificationBlocksInAppPublic = appPublic.table("notification_blocks", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	blockId: bigint("block_id", { mode: "number" }).notNull(),
	blockType: notificationBlockTypeInAppPublic("block_type").notNull(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.blockId], name: "notification_blocks_pkey"}),
]);

export const notificationsInAppPublic = appPublic.table("notifications", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	keyword: text().notNull(),
}, (table) => [
	index("notification_guild_id_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops")),
	index("notification_keyword_idx").using("btree", table.keyword.asc().nullsLast().op("text_ops")),
	index("notifications_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.userId, table.guildId, table.keyword], name: "notifications_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const xpBlocksInAppPublic = appPublic.table("xp_blocks", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	blockId: bigint("block_id", { mode: "number" }).notNull(),
	blockType: blockTypeInAppPublic("block_type").notNull(),
}, (table) => [
	primaryKey({ columns: [table.guildId, table.blockId], name: "xp_blocks_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const emojiStickerStatsRateLimitsInAppPublic = appPublic.table("emoji_sticker_stats_rate_limits", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	assetId: bigint("asset_id", { mode: "number" }).notNull(),
	actionType: emojiStickerActionTypeInAppPublic("action_type").notNull(),
	lastUsed: timestamp("last_used", { mode: 'string' }).default(sql`timezone('utc'::text, now())`).notNull(),
}, (table) => [
	index("emoji_sticker_stats_rate_limits_idx_last_used").using("btree", table.lastUsed.asc().nullsLast().op("timestamp_ops")),
	primaryKey({ columns: [table.userId, table.assetId, table.actionType], name: "emoji_sticker_stats_rate_limits_pkey"}),
]);

export const giveawayEntriesInAppPublic = appPublic.table("giveaway_entries", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	giveawayId: bigint("giveaway_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	isPicked: boolean("is_picked").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.giveawayId],
			foreignColumns: [giveawaysInAppPublic.id],
			name: "giveaway_entries_giveaway_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.giveawayId, table.userId], name: "giveaway_entries_pkey"}),
]);

export const levelRolesInAppPublic = appPublic.table("level_roles", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	roleId: bigint("role_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	addLevel: bigint("add_level", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	removeLevel: bigint("remove_level", { mode: "number" }),
}, (table) => [
	index("level_roles_guild_id_add_level_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops"), table.addLevel.asc().nullsLast().op("int8_ops")),
	index("level_roles_guild_id_remove_level_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops"), table.removeLevel.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.guildId, table.roleId], name: "level_roles_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
	check("chk_add_before_remove", sql`add_level < remove_level`),
	check("chk_at_least_one_level", sql`num_nonnulls(add_level, remove_level) >= 1`),
]);

export const tempBansInAppPublic = appPublic.table("temp_bans", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_temp_bans_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_temp_bans_guild_id").using("btree", table.guildId.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.userId, table.guildId], name: "temp_bans_pkey"}),
]);

export const botStatsInAppPublic = appPublic.table("bot_stats", {
	name: text().notNull(),
	category: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	count: bigint({ mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bot_stats_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
	primaryKey({ columns: [table.name, table.category], name: "bot_stats_pkey"}),
	pgPolicy("select_stats", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
]);

export const remindersInAppPublic = appPublic.table("reminders", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	description: text().notNull(),
	setAt: timestamp("set_at", { withTimezone: true, mode: 'string' }).notNull(),
	expireAt: timestamp("expire_at", { withTimezone: true, mode: 'string' }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.id], name: "reminders_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const roleMenuRolesInAppPublic = appPublic.table("role_menu_roles", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	menuName: text("menu_name").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	roleId: bigint("role_id", { mode: "number" }).notNull(),
	emoji: text(),
	description: varchar({ length: 100 }),
	position: integer(),
}, (table) => [
	foreignKey({
			columns: [table.guildId, table.menuName],
			foreignColumns: [roleMenusInAppPublic.guildId, roleMenusInAppPublic.menuName],
			name: "role_menu_roles_guild_id_menu_name_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.guildId, table.menuName, table.roleId], name: "role_menu_roles_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const emojiStickerStatsInAppPublic = appPublic.table("emoji_sticker_stats", {
	time: timestamp({ mode: 'string' }).default(sql`date_trunc('day'::text, timezone('utc'::text, now()))`).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	assetId: bigint("asset_id", { mode: "number" }).notNull(),
	actionType: emojiStickerActionTypeInAppPublic("action_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	count: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	countExternal: bigint("count_external", { mode: "number" }).default(sql`(0)`).notNull(),
}, (table) => [
	index("idx_action_type").using("btree", table.actionType.asc().nullsLast().op("enum_ops"), table.time.asc().nullsLast().op("timestamp_ops")),
	index("idx_by_guild_emojis").using("btree", table.assetId.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.time, table.assetId, table.actionType], name: "emoji_sticker_stats_pkey"}),
	check("emoji_sticker_stats_time_check", sql`"time" = date_trunc('day'::text, "time")`),
]);

export const mutesInAppPublic = appPublic.table("mutes", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	startTime: timestamp("start_time", { mode: 'string' }).notNull(),
	endTime: timestamp("end_time", { mode: 'string' }),
	pending: boolean().default(false).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	caseId: bigint("case_id", { mode: "number" }),
}, (table) => [
	foreignKey({
			columns: [table.guildId, table.caseId],
			foreignColumns: [modLogsInAppPublic.guildId, modLogsInAppPublic.caseId],
			name: "fk_mod_action"
		}),
	primaryKey({ columns: [table.guildId, table.userId], name: "mutes_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const reactionStartersInAppPublic = appPublic.table("reaction_starters", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	messageId: bigint("message_id", { mode: "number" }).notNull(),
	emojiId: text("emoji_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	emojiName: text("emoji_name"),
}, (table) => [
	index("reaction_starters_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("reaction_starters_guild_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops")),
	index("reaction_starters_message_emoji_idx").using("btree", table.messageId.asc().nullsLast().op("int8_ops"), table.emojiId.asc().nullsLast().op("text_ops")),
	primaryKey({ columns: [table.messageId, table.emojiId, table.userId], name: "reaction_starters_pkey"}),
]);

export const roleMenusInAppPublic = appPublic.table("role_menus", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	menuName: text("menu_name").notNull(),
	description: text(),
	maxCount: integer("max_count"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	requiredRole: bigint("required_role", { mode: "number" }),
	id: serial().notNull(),
}, (table) => [
	index("rolemenu_guildid_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops")),
	index("rolemenu_name_idx").using("btree", table.menuName.asc().nullsLast().op("text_pattern_ops")),
	primaryKey({ columns: [table.guildId, table.menuName], name: "role_menus_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const tagsInAppPublic = appPublic.table("tags", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	ownerId: bigint("owner_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	tagName: text("tag_name").notNull(),
	content: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	useCount: bigint("use_count", { mode: "number" }).notNull(),
	created: timestamp({ mode: 'string' }).notNull(),
	attachment: text(),
}, (table) => [
	index("tag_name_idx").using("gin", table.tagName.asc().nullsLast().op("gin_trgm_ops")),
	primaryKey({ columns: [table.guildId, table.tagName], name: "tags_pkey"}),
	pgPolicy("select_all", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"] }),
]);

export const userLevelsInAppPublic = appPublic.table("user_levels", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	msgAllTime: bigint("msg_all_time", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	msgMonth: bigint("msg_month", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	msgWeek: bigint("msg_week", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	msgDay: bigint("msg_day", { mode: "number" }).notNull(),
	lastMsg: timestamp("last_msg", { mode: 'string' }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.guildId], name: "user_levels_pkey"}),
	pgPolicy("select_all", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"] }),
]);

export const roleMenuMessagesInAppPublic = appPublic.table("role_menu_messages", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	menuName: text("menu_name").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	messageId: bigint("message_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	needsUpdate: boolean("needs_update").default(false).notNull(),
	componentType: text("component_type").default('buttons').notNull(),
}, (table) => [
	index("idx_role_menu_messages_lookup").using("btree", table.guildId.asc().nullsLast().op("int8_ops"), table.menuName.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.guildId, table.menuName],
			foreignColumns: [roleMenusInAppPublic.guildId, roleMenusInAppPublic.menuName],
			name: "role_menu_messages_guild_id_menu_name_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.guildId, table.menuName, table.messageId], name: "role_menu_messages_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);

export const scheduleEventsInAppPublic = appPublic.table("schedule_events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	calendarId: text("calendar_id").notNull(),
	eventId: text("event_id").notNull(),
	summary: text().notNull(),
	startUtc: timestamp("start_utc", { withTimezone: true, mode: 'string' }),
	startDate: text("start_date"),
	isAllDay: boolean("is_all_day").default(false).notNull(),
	url: text(),
	location: text(),
	status: text().default('confirmed').notNull(),
}, (table) => [
	index("schedule_events_calendar_start_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops"), table.calendarId.asc().nullsLast().op("timestamptz_ops"), table.startUtc.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.guildId, table.calendarId],
			foreignColumns: [schedulesInAppPublic.guildId, schedulesInAppPublic.calendarId],
			name: "fk_schedule_events_schedule"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.guildId, table.calendarId, table.eventId], name: "schedule_events_pkey"}),
]);

export const scheduleMessagesInAppPublic = appPublic.table("schedule_messages", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	calendarId: text("calendar_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
	year: smallint().notNull(),
	month: smallint().notNull(),
	messageIndex: smallint("message_index").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	messageId: bigint("message_id", { mode: "number" }).notNull(),
	contentHash: text("content_hash").default(').notNull(),
	isArchived: boolean("is_archived").default(false).notNull(),
	lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("schedule_messages_calendar_idx").using("btree", table.guildId.asc().nullsLast().op("int8_ops"), table.calendarId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.guildId, table.calendarId],
			foreignColumns: [schedulesInAppPublic.guildId, schedulesInAppPublic.calendarId],
			name: "fk_schedule_messages_schedule"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.guildId, table.calendarId, table.year, table.month, table.messageIndex], name: "schedule_messages_pkey"}),
]);

export const schedulesInAppPublic = appPublic.table("schedules", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	calendarId: text("calendar_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	channelId: bigint("channel_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	logChannelId: bigint("log_channel_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	configuredByUserId: bigint("configured_by_user_id", { mode: "number" }).notNull(),
	calendarTitle: text("calendar_title").default(').notNull(),
	displayTitle: text("display_title"),
	syncToken: text("sync_token"),
	pollIntervalSec: integer("poll_interval_sec").default(120).notNull(),
	nextPollAt: timestamp("next_poll_at", { withTimezone: true, mode: 'string' }).notNull(),
	consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
	lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: 'string' }),
	lastErrorReason: text("last_error_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accentColor: integer("accent_color"),
}, (table) => [
	index("schedules_next_poll_at_idx").using("btree", table.nextPollAt.asc().nullsLast().op("timestamptz_ops")),
	primaryKey({ columns: [table.guildId, table.calendarId], name: "schedules_pkey"}),
	unique("schedules_channel_id_unique").on(table.channelId),
]);

export const modLogsInAppPublic = appPublic.table("mod_logs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guildId: bigint("guild_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	caseId: bigint("case_id", { mode: "number" }).notNull(),
	action: text().notNull(),
	actionTime: timestamp("action_time", { mode: 'string' }).notNull(),
	pending: boolean().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	userTag: text("user_tag").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	executorId: bigint("executor_id", { mode: "number" }),
	reason: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	msgId: bigint("msg_id", { mode: "number" }),
	attachments: text().array().default([""]).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dmChannelId: bigint("dm_channel_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dmMessageId: bigint("dm_message_id", { mode: "number" }),
	dmMessageError: text("dm_message_error"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	timeoutDuration: bigint("timeout_duration", { mode: "number" }),
	dmIntended: boolean("dm_intended").default(false).notNull(),
	dmIntentSource: text("dm_intent_source").default('unknown').notNull(),
	dmAttempted: boolean("dm_attempted").default(false).notNull(),
	dmNotAttemptedReason: text("dm_not_attempted_reason"),
	dmFailureReason: text("dm_failure_reason"),
}, (table) => [
	index("idx_mod_logs_case_range").using("btree", table.guildId.asc().nullsLast().op("int8_ops"), table.caseId.asc().nullsLast().op("int8_ops")),
	index("idx_mod_logs_guild_activity").using("btree", table.guildId.asc().nullsLast().op("timestamp_ops"), table.actionTime.asc().nullsLast().op("timestamp_ops")),
	index("idx_mod_logs_pending_cases").using("btree", table.guildId.asc().nullsLast().op("bool_ops"), table.userId.asc().nullsLast().op("timestamp_ops"), table.action.asc().nullsLast().op("timestamp_ops"), table.pending.asc().nullsLast().op("bool_ops"), table.actionTime.asc().nullsLast().op("int8_ops")),
	index("idx_mod_logs_user_history").using("btree", table.guildId.asc().nullsLast().op("timestamp_ops"), table.userId.asc().nullsLast().op("timestamp_ops"), table.actionTime.asc().nullsLast().op("int8_ops")),
	primaryKey({ columns: [table.guildId, table.caseId], name: "mod_logs_pkey"}),
	pgPolicy("admin_access", { as: "permissive", for: "all", to: ["sushii_admin"], using: sql`true` }),
]);
