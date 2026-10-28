import type { Result } from "ts-results";

import type { ReasonTemplate } from "./ReasonTemplate";

export type ReasonTemplateConflict = "shortcut_taken" | "duplicate";

export interface CreateReasonTemplateInput {
  guildId: string;
  shortcut: string | null;
  content: string;
  contentKey: string;
  createdBy: string;
}

export interface UpdateReasonTemplateInput {
  shortcut: string | null;
  content: string;
  contentKey: string;
}

export interface ReasonTemplateRepository {
  /** Ordered by use_count desc, id asc. */
  listByGuild(
    guildId: string,
    page: { limit: number; offset: number },
  ): Promise<ReasonTemplate[]>;

  /** Same order as listByGuild. */
  listAllByGuild(guildId: string): Promise<ReasonTemplate[]>;

  countByGuild(guildId: string): Promise<number>;

  findById(guildId: string, id: string): Promise<ReasonTemplate | null>;

  findByShortcut(
    guildId: string,
    shortcut: string,
  ): Promise<ReasonTemplate | null>;

  findByContentKey(
    guildId: string,
    contentKey: string,
  ): Promise<ReasonTemplate | null>;

  create(
    input: CreateReasonTemplateInput,
  ): Promise<Result<ReasonTemplate, ReasonTemplateConflict>>;

  update(
    guildId: string,
    id: string,
    input: UpdateReasonTemplateInput,
  ): Promise<Result<ReasonTemplate, "not_found" | ReasonTemplateConflict>>;

  delete(guildId: string, id: string): Promise<boolean>;

  recordUse(guildId: string, id: string): Promise<void>;

  /** Across every guild. */
  countStats(): Promise<{ guilds: number; total: number }>;
}
