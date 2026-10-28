import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type {
  ModLogCaseOperations,
  ModLogReasonQueries,
  RecentReason,
} from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { REASON_MAX_LENGTH } from "@/features/moderation/shared/domain/value-objects/Reason";

import type { ExpandResult } from "../domain/ReasonExpander";
import {
  RECENT_TOKEN_PATTERN,
  expandReason,
  normalizeReason,
  normalizeShortcut,
  reasonContentKey,
} from "../domain/ReasonExpander";
import type { ReasonTemplate } from "../domain/ReasonTemplate";
import type {
  ReasonTemplateConflict,
  ReasonTemplateRepository,
} from "../domain/ReasonTemplateRepository";

export const REASON_TEMPLATE_LIMIT = 100;
export const REASON_TEMPLATE_PAGE_SIZE = 5;
/** One select slot is kept for "Same as last reason". */
export const FORM_TEMPLATE_LIMIT = 24;
export const RECENT_REASON_LIMIT = 10;
export const SAVE_PROMPT_THRESHOLD = 3;

export type ReasonTemplateError =
  | { code: "empty" }
  | { code: "too_long"; length: number; max: number }
  | { code: "invalid_shortcut"; shortcut: string }
  /** owner is null when the owning template vanished before it could be read. */
  | { code: "shortcut_taken"; shortcut: string; owner: ReasonTemplate | null }
  | { code: "duplicate"; existing: ReasonTemplate | null }
  | { code: "limit_reached"; limit: number }
  | { code: "not_found" };

export interface ReasonTemplatePage {
  items: ReasonTemplate[];
  total: number;
  /** 1-based, clamped to [1, pages]. */
  page: number;
  /** At least 1, even with no templates. */
  pages: number;
}

export interface ReasonFormData {
  last: { reason: string; executorId: string | null; actionTime: Date } | null;
  templates: ReasonTemplate[];
}

export interface ReasonTemplateInput {
  content: string;
  /** May carry a leading `!`; empty or null means no shortcut. */
  shortcut: string | null;
}

interface ValidatedInput {
  content: string;
  contentKey: string;
  shortcut: string | null;
}

export class ReasonTemplateService {
  constructor(
    private readonly repository: ReasonTemplateRepository,
    private readonly modLogReasons: ModLogReasonQueries &
      Pick<ModLogCaseOperations, "findByIds">,
  ) {}

  async list(
    guildId: string,
    page: number,
    pageSize = REASON_TEMPLATE_PAGE_SIZE,
  ): Promise<ReasonTemplatePage> {
    const total = await this.repository.countByGuild(guildId);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(Math.max(1, Math.floor(page)), pages);

    const items =
      total === 0
        ? []
        : await this.repository.listByGuild(guildId, {
            limit: pageSize,
            offset: (current - 1) * pageSize,
          });

    return { items, total, page: current, pages };
  }

  get(guildId: string, id: string): Promise<ReasonTemplate | null> {
    return this.repository.findById(guildId, id);
  }

  listAll(guildId: string): Promise<ReasonTemplate[]> {
    return this.repository.listAllByGuild(guildId);
  }

  async create(
    guildId: string,
    input: ReasonTemplateInput & { createdBy: string },
  ): Promise<Result<ReasonTemplate, ReasonTemplateError>> {
    const validated = this.validate(input);
    if (validated.err) {
      return validated;
    }

    const total = await this.repository.countByGuild(guildId);
    if (total >= REASON_TEMPLATE_LIMIT) {
      return Err({ code: "limit_reached", limit: REASON_TEMPLATE_LIMIT });
    }

    const created = await this.repository.create({
      guildId,
      createdBy: input.createdBy,
      ...validated.val,
    });
    if (created.err) {
      return Err(
        await this.describeConflict(guildId, created.val, validated.val),
      );
    }

    return created;
  }

  async update(
    guildId: string,
    id: string,
    input: ReasonTemplateInput,
  ): Promise<Result<ReasonTemplate, ReasonTemplateError>> {
    const validated = this.validate(input);
    if (validated.err) {
      return validated;
    }

    const updated = await this.repository.update(guildId, id, validated.val);
    if (updated.err) {
      if (updated.val === "not_found") {
        return Err({ code: "not_found" });
      }

      return Err(
        await this.describeConflict(guildId, updated.val, validated.val),
      );
    }

    return updated;
  }

  delete(guildId: string, id: string): Promise<boolean> {
    return this.repository.delete(guildId, id);
  }

  /** Expands typed reason input. Doesn't record template use. */
  async resolve(
    guildId: string,
    input: string | null,
  ): Promise<ExpandResult | null> {
    if (!input?.trim()) {
      return null;
    }

    const [templates, recents] = await Promise.all([
      this.repository.listAllByGuild(guildId),
      this.modLogReasons.findRecentDistinctReasons(
        guildId,
        RECENT_REASON_LIMIT,
      ),
    ]);

    const result = expandReason(input, { templates, recents });
    if (result.unresolved?.kind !== "token") {
      return result;
    }

    // A recent token stays valid after newer cases push it out of the window.
    const recentToken = RECENT_TOKEN_PATTERN.exec(input.trim());
    if (!recentToken?.[1]) {
      return result;
    }

    const [recentCase] = await this.modLogReasons.findByIds(guildId, [
      recentToken[1],
    ]);
    const reason = recentCase?.reason?.value;
    if (!reason) {
      return result;
    }

    return {
      text: reason,
      template: null,
      unknownShortcut: null,
      source: "token",
      unresolved: null,
    };
  }

  recordUse(guildId: string, templateId: string): Promise<void> {
    return this.repository.recordUse(guildId, templateId);
  }

  async getFormData(guildId: string): Promise<ReasonFormData> {
    const [last, templates] = await Promise.all([
      this.modLogReasons.findLastReason(guildId),
      this.repository.listByGuild(guildId, {
        limit: FORM_TEMPLATE_LIMIT,
        offset: 0,
      }),
    ]);

    return {
      last: last
        ? {
            reason: last.reason,
            executorId: last.executorId,
            actionTime: last.actionTime,
          }
        : null,
      templates,
    };
  }

  async shouldPromptSave(
    guildId: string,
    reasonText: string | null,
  ): Promise<boolean> {
    if (!reasonText?.trim()) {
      return false;
    }

    const contentKey = reasonContentKey(reasonText);
    const existing = await this.repository.findByContentKey(
      guildId,
      contentKey,
    );
    if (existing) {
      return false;
    }

    const uses = await this.modLogReasons.countByNormalizedReason(
      guildId,
      normalizeReason(reasonText),
      SAVE_PROMPT_THRESHOLD,
    );

    return uses >= SAVE_PROMPT_THRESHOLD;
  }

  recentReasons(guildId: string, limit: number): Promise<RecentReason[]> {
    return this.modLogReasons.findRecentDistinctReasons(guildId, limit);
  }

  private validate(
    input: ReasonTemplateInput,
  ): Result<ValidatedInput, ReasonTemplateError> {
    const content = input.content.trim();
    if (!content) {
      return Err({ code: "empty" });
    }

    if (content.length > REASON_MAX_LENGTH) {
      return Err({
        code: "too_long",
        length: content.length,
        max: REASON_MAX_LENGTH,
      });
    }

    const rawShortcut = input.shortcut?.trim() ?? "";
    let shortcut: string | null = null;
    if (rawShortcut) {
      const normalized = normalizeShortcut(rawShortcut);
      if (normalized.err) {
        return Err({ code: "invalid_shortcut", shortcut: rawShortcut });
      }

      shortcut = normalized.val;
    }

    return Ok({ content, contentKey: reasonContentKey(content), shortcut });
  }

  // Looked up after the failed write so the unique index stays the only check.
  private async describeConflict(
    guildId: string,
    conflict: ReasonTemplateConflict,
    input: ValidatedInput,
  ): Promise<ReasonTemplateError> {
    if (conflict === "shortcut_taken" && input.shortcut) {
      return {
        code: "shortcut_taken",
        shortcut: input.shortcut,
        owner: await this.repository.findByShortcut(guildId, input.shortcut),
      };
    }

    return {
      code: "duplicate",
      existing: await this.repository.findByContentKey(
        guildId,
        input.contentKey,
      ),
    };
  }
}
