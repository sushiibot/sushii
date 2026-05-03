import { relations } from "drizzle-orm/relations";
import { giveawaysInAppPublic, giveawayEntriesInAppPublic, roleMenusInAppPublic, roleMenuRolesInAppPublic, modLogsInAppPublic, mutesInAppPublic, roleMenuMessagesInAppPublic, schedulesInAppPublic, scheduleEventsInAppPublic, scheduleMessagesInAppPublic } from "./schema";

export const giveawayEntriesInAppPublicRelations = relations(giveawayEntriesInAppPublic, ({one}) => ({
	giveawaysInAppPublic: one(giveawaysInAppPublic, {
		fields: [giveawayEntriesInAppPublic.giveawayId],
		references: [giveawaysInAppPublic.id]
	}),
}));

export const giveawaysInAppPublicRelations = relations(giveawaysInAppPublic, ({many}) => ({
	giveawayEntriesInAppPublics: many(giveawayEntriesInAppPublic),
}));

export const roleMenuRolesInAppPublicRelations = relations(roleMenuRolesInAppPublic, ({one}) => ({
	roleMenusInAppPublic: one(roleMenusInAppPublic, {
		fields: [roleMenuRolesInAppPublic.guildId],
		references: [roleMenusInAppPublic.guildId]
	}),
}));

export const roleMenusInAppPublicRelations = relations(roleMenusInAppPublic, ({many}) => ({
	roleMenuRolesInAppPublics: many(roleMenuRolesInAppPublic),
	roleMenuMessagesInAppPublics: many(roleMenuMessagesInAppPublic),
}));

export const mutesInAppPublicRelations = relations(mutesInAppPublic, ({one}) => ({
	modLogsInAppPublic: one(modLogsInAppPublic, {
		fields: [mutesInAppPublic.guildId],
		references: [modLogsInAppPublic.guildId]
	}),
}));

export const modLogsInAppPublicRelations = relations(modLogsInAppPublic, ({many}) => ({
	mutesInAppPublics: many(mutesInAppPublic),
}));

export const roleMenuMessagesInAppPublicRelations = relations(roleMenuMessagesInAppPublic, ({one}) => ({
	roleMenusInAppPublic: one(roleMenusInAppPublic, {
		fields: [roleMenuMessagesInAppPublic.guildId],
		references: [roleMenusInAppPublic.guildId]
	}),
}));

export const scheduleEventsInAppPublicRelations = relations(scheduleEventsInAppPublic, ({one}) => ({
	schedulesInAppPublic: one(schedulesInAppPublic, {
		fields: [scheduleEventsInAppPublic.guildId],
		references: [schedulesInAppPublic.guildId]
	}),
}));

export const schedulesInAppPublicRelations = relations(schedulesInAppPublic, ({many}) => ({
	scheduleEventsInAppPublics: many(scheduleEventsInAppPublic),
	scheduleMessagesInAppPublics: many(scheduleMessagesInAppPublic),
}));

export const scheduleMessagesInAppPublicRelations = relations(scheduleMessagesInAppPublic, ({one}) => ({
	schedulesInAppPublic: one(schedulesInAppPublic, {
		fields: [scheduleMessagesInAppPublic.guildId],
		references: [schedulesInAppPublic.guildId]
	}),
}));