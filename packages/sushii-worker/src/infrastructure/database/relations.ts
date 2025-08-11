import { relations } from "drizzle-orm/relations";

import {
  giveawayEntriesInAppPublic,
  giveawaysInAppPublic,
  modLogsInAppPublic,
  mutesInAppPublic,
  roleMenuRolesInAppPublic,
  roleMenusInAppPublic,
} from "./schema";

export const giveawayEntriesInAppPublicRelations = relations(
  giveawayEntriesInAppPublic,
  ({ one }) => ({
    giveawaysInAppPublic: one(giveawaysInAppPublic, {
      fields: [giveawayEntriesInAppPublic.giveawayId],
      references: [giveawaysInAppPublic.id],
    }),
  }),
);

export const giveawaysInAppPublicRelations = relations(
  giveawaysInAppPublic,
  ({ many }) => ({
    giveawayEntriesInAppPublics: many(giveawayEntriesInAppPublic),
  }),
);

export const mutesInAppPublicRelations = relations(
  mutesInAppPublic,
  ({ one }) => ({
    modLogsInAppPublic: one(modLogsInAppPublic, {
      fields: [mutesInAppPublic.guildId],
      references: [modLogsInAppPublic.guildId],
    }),
  }),
);

export const modLogsInAppPublicRelations = relations(
  modLogsInAppPublic,
  ({ many }) => ({
    mutesInAppPublics: many(mutesInAppPublic),
  }),
);

export const roleMenuRolesInAppPublicRelations = relations(
  roleMenuRolesInAppPublic,
  ({ one }) => ({
    roleMenusInAppPublic: one(roleMenusInAppPublic, {
      fields: [roleMenuRolesInAppPublic.guildId],
      references: [roleMenusInAppPublic.guildId],
    }),
  }),
);

export const roleMenusInAppPublicRelations = relations(
  roleMenusInAppPublic,
  ({ many }) => ({
    roleMenuRolesInAppPublics: many(roleMenuRolesInAppPublic),
  }),
);
