import { relations } from "drizzle-orm/relations";

import {
  giveawayEntriesInAppPublic,
  giveawaysInAppPublic,
  modLogProofsInAppPublic,
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
    modLogProofsInAppPublics: many(modLogProofsInAppPublic),
  }),
);

export const modLogProofsInAppPublicRelations = relations(
  modLogProofsInAppPublic,
  ({ one }) => ({
    modLogsInAppPublic: one(modLogsInAppPublic, {
      fields: [modLogProofsInAppPublic.guildId, modLogProofsInAppPublic.caseId],
      references: [modLogsInAppPublic.guildId, modLogsInAppPublic.caseId],
    }),
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
