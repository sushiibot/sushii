import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type { userNameHistoryInAppPublic } from "@/infrastructure/database/schema";

export type UserNameHistoryEntry = InferSelectModel<
  typeof userNameHistoryInAppPublic
>;
export type NewUserNameHistoryEntry = InferInsertModel<
  typeof userNameHistoryInAppPublic
>;
