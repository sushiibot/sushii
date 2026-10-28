import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Err, Ok } from "ts-results";

import type {
  ModLogCaseOperations,
  ModLogReasonQueries,
} from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { REASON_MAX_LENGTH } from "@/features/moderation/shared/domain/value-objects/Reason";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import { reasonContentKey } from "../domain/ReasonExpander";
import type { ReasonTemplate } from "../domain/ReasonTemplate";
import type { ReasonTemplateRepository } from "../domain/ReasonTemplateRepository";
import {
  REASON_TEMPLATE_LIMIT,
  ReasonTemplateService,
} from "./ReasonTemplateService";

const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";

function makeTemplate(overrides: Partial<ReasonTemplate> = {}): ReasonTemplate {
  return {
    id: "1",
    guildId: GUILD_ID,
    shortcut: "spam",
    content: "Spamming in chat.",
    contentKey: "spamming in chat.",
    createdBy: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: null,
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

describe("ReasonTemplateService", () => {
  let repository: ReasonTemplateRepository;
  let modLogReasons: ModLogReasonQueries &
    Pick<ModLogCaseOperations, "findByIds">;
  let service: ReasonTemplateService;

  beforeEach(() => {
    repository = {
      listByGuild: mock(() => Promise.resolve([])),
      listAllByGuild: mock(() => Promise.resolve([])),
      countByGuild: mock(() => Promise.resolve(0)),
      findById: mock(() => Promise.resolve(null)),
      findByShortcut: mock(() => Promise.resolve(null)),
      findByContentKey: mock(() => Promise.resolve(null)),
      create: mock((input) =>
        Promise.resolve(Ok(makeTemplate({ ...input, id: "5" }))),
      ),
      update: mock((_guildId, id, input) =>
        Promise.resolve(Ok(makeTemplate({ ...input, id }))),
      ),
      delete: mock(() => Promise.resolve(true)),
      recordUse: mock(() => Promise.resolve()),
    };
    modLogReasons = {
      findLastReason: mock(() => Promise.resolve(null)),
      findRecentDistinctReasons: mock(() => Promise.resolve([])),
      countByNormalizedReason: mock(() => Promise.resolve(0)),
      findByIds: mock(() => Promise.resolve([])),
    };
    service = new ReasonTemplateService(repository, modLogReasons);
  });

  describe("create", () => {
    test("trims content, normalizes shortcut and stores the content key", async () => {
      const result = await service.create(GUILD_ID, {
        content: "  Spamming   In chat ",
        shortcut: " !Spam ",
        createdBy: USER_ID,
      });

      expect(result.ok).toBe(true);
      expect(repository.create).toHaveBeenCalledWith({
        guildId: GUILD_ID,
        createdBy: USER_ID,
        content: "Spamming   In chat",
        contentKey: reasonContentKey("spamming in chat"),
        shortcut: "spam",
      });
    });

    test("empty shortcut string means no shortcut", async () => {
      await service.create(GUILD_ID, {
        content: "Text",
        shortcut: "  ",
        createdBy: USER_ID,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ shortcut: null }),
      );
    });

    test("validation order: empty before everything", async () => {
      const result = await service.create(GUILD_ID, {
        content: "   ",
        shortcut: "!!bad",
        createdBy: USER_ID,
      });

      expect(result.val).toEqual({ code: "empty" });
    });

    test("validation order: too_long before invalid_shortcut", async () => {
      const result = await service.create(GUILD_ID, {
        content: "x".repeat(REASON_MAX_LENGTH + 5),
        shortcut: "!!bad",
        createdBy: USER_ID,
      });

      expect(result.val).toEqual({
        code: "too_long",
        length: REASON_MAX_LENGTH + 5,
        max: REASON_MAX_LENGTH,
      });
    });

    test("validation order: invalid_shortcut before limit_reached", async () => {
      repository.countByGuild = mock(() =>
        Promise.resolve(REASON_TEMPLATE_LIMIT),
      );

      const result = await service.create(GUILD_ID, {
        content: "Text",
        shortcut: "has space",
        createdBy: USER_ID,
      });

      expect(result.val).toEqual({
        code: "invalid_shortcut",
        shortcut: "has space",
      });
      expect(repository.countByGuild).not.toHaveBeenCalled();
    });

    test("limit_reached at 100 templates", async () => {
      repository.countByGuild = mock(() =>
        Promise.resolve(REASON_TEMPLATE_LIMIT),
      );

      const result = await service.create(GUILD_ID, {
        content: "Text",
        shortcut: null,
        createdBy: USER_ID,
      });

      expect(result.val).toEqual({
        code: "limit_reached",
        limit: REASON_TEMPLATE_LIMIT,
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    test("shortcut_taken carries the owning template", async () => {
      const owner = makeTemplate({ id: "9", content: "Other reason" });
      repository.create = mock(() =>
        Promise.resolve(Err("shortcut_taken" as const)),
      );
      repository.findByShortcut = mock(() => Promise.resolve(owner));

      const result = await service.create(GUILD_ID, {
        content: "Text",
        shortcut: "spam",
        createdBy: USER_ID,
      });

      expect(result.val).toEqual({
        code: "shortcut_taken",
        shortcut: "spam",
        owner,
      });
      expect(repository.findByShortcut).toHaveBeenCalledWith(GUILD_ID, "spam");
    });

    test("duplicate carries the existing template", async () => {
      const existing = makeTemplate({ id: "9" });
      repository.create = mock(() =>
        Promise.resolve(Err("duplicate" as const)),
      );
      repository.findByContentKey = mock(() => Promise.resolve(existing));

      const result = await service.create(GUILD_ID, {
        content: "Spamming in chat.",
        shortcut: null,
        createdBy: USER_ID,
      });

      expect(result.val).toEqual({ code: "duplicate", existing });
      expect(repository.findByContentKey).toHaveBeenCalledWith(
        GUILD_ID,
        reasonContentKey("spamming in chat."),
      );
    });
  });

  describe("update", () => {
    test("passes normalized input to the repository", async () => {
      const result = await service.update(GUILD_ID, "3", {
        content: "New text",
        shortcut: "!New",
      });

      expect(result.ok).toBe(true);
      expect(repository.update).toHaveBeenCalledWith(GUILD_ID, "3", {
        content: "New text",
        contentKey: reasonContentKey("new text"),
        shortcut: "new",
      });
    });

    test("doesn't check the template limit", async () => {
      repository.countByGuild = mock(() =>
        Promise.resolve(REASON_TEMPLATE_LIMIT),
      );

      const result = await service.update(GUILD_ID, "3", {
        content: "New text",
        shortcut: null,
      });

      expect(result.ok).toBe(true);
    });

    test("maps not_found", async () => {
      repository.update = mock(() =>
        Promise.resolve(Err("not_found" as const)),
      );

      const result = await service.update(GUILD_ID, "3", {
        content: "New text",
        shortcut: null,
      });

      expect(result.val).toEqual({ code: "not_found" });
    });

    test("validates before touching the repository", async () => {
      const result = await service.update(GUILD_ID, "3", {
        content: "",
        shortcut: null,
      });

      expect(result.val).toEqual({ code: "empty" });
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    test("pages are 1-based and clamped", async () => {
      repository.countByGuild = mock(() => Promise.resolve(12));

      const result = await service.list(GUILD_ID, 9);

      expect(result).toMatchObject({ total: 12, page: 3, pages: 3 });
      expect(repository.listByGuild).toHaveBeenCalledWith(GUILD_ID, {
        limit: 5,
        offset: 10,
      });
    });

    test("empty guild has one empty page", async () => {
      const result = await service.list(GUILD_ID, 0);

      expect(result).toEqual({ items: [], total: 0, page: 1, pages: 1 });
      expect(repository.listByGuild).not.toHaveBeenCalled();
    });
  });

  describe("resolve", () => {
    test("returns null for empty input", async () => {
      expect(await service.resolve(GUILD_ID, null)).toBeNull();
      expect(await service.resolve(GUILD_ID, "  ")).toBeNull();
      expect(repository.listAllByGuild).not.toHaveBeenCalled();
    });

    test("expands against templates and 10 recents without recording use", async () => {
      repository.listAllByGuild = mock(() => Promise.resolve([makeTemplate()]));

      const result = await service.resolve(GUILD_ID, "!spam again");

      expect(result).toEqual({
        text: "Spamming in chat. Again",
        template: { id: "1", shortcut: "spam" },
        unknownShortcut: null,
        source: "shortcut",
        unresolved: null,
      });
      expect(modLogReasons.findRecentDistinctReasons).toHaveBeenCalledWith(
        GUILD_ID,
        10,
      );
      expect(repository.recordUse).not.toHaveBeenCalled();
    });
    test("recent token outside the recents window is loaded by case id", async () => {
      modLogReasons.findByIds = mock(() =>
        Promise.resolve([
          makeModerationCase({
            guildId: GUILD_ID,
            caseId: "4821",
            reason: "Raid",
          }),
        ]),
      );

      const result = await service.resolve(GUILD_ID, "recent:4821");

      expect(result).toEqual({
        text: "Raid",
        template: null,
        unknownShortcut: null,
        source: "token",
        unresolved: null,
      });
      expect(modLogReasons.findByIds).toHaveBeenCalledWith(GUILD_ID, ["4821"]);
    });

    test("missing recent case stays unresolved", async () => {
      const result = await service.resolve(GUILD_ID, "recent:4821");

      expect(result).toEqual({
        text: "recent:4821",
        template: null,
        unknownShortcut: null,
        source: "none",
        unresolved: { kind: "token", input: "recent:4821" },
      });
    });

    test("unresolved template token doesn't look up cases", async () => {
      const result = await service.resolve(GUILD_ID, "template:77");

      expect(result?.unresolved).toEqual({
        kind: "token",
        input: "template:77",
      });
      expect(modLogReasons.findByIds).not.toHaveBeenCalled();
    });

    test("plain text doesn't look up cases", async () => {
      await service.resolve(GUILD_ID, "just text");

      expect(modLogReasons.findByIds).not.toHaveBeenCalled();
    });
  });

  describe("getFormData", () => {
    test("returns the last reason and the top 24 templates", async () => {
      const actionTime = new Date("2026-02-01T00:00:00Z");
      modLogReasons.findLastReason = mock(() =>
        Promise.resolve({
          caseId: "7",
          reason: "Last one",
          executorId: USER_ID,
          actionTime,
        }),
      );

      const result = await service.getFormData(GUILD_ID);

      expect(result.last).toEqual({
        reason: "Last one",
        executorId: USER_ID,
        actionTime,
      });
      expect(repository.listByGuild).toHaveBeenCalledWith(GUILD_ID, {
        limit: 24,
        offset: 0,
      });
    });
  });

  describe("shouldPromptSave", () => {
    test("true at 3 uses with no matching template", async () => {
      modLogReasons.countByNormalizedReason = mock(() => Promise.resolve(3));

      expect(await service.shouldPromptSave(GUILD_ID, " Spam  Links ")).toBe(
        true,
      );
      expect(modLogReasons.countByNormalizedReason).toHaveBeenCalledWith(
        GUILD_ID,
        "spam links",
        3,
      );
      expect(repository.findByContentKey).toHaveBeenCalledWith(
        GUILD_ID,
        reasonContentKey("spam links"),
      );
    });

    test("false below 3 uses", async () => {
      modLogReasons.countByNormalizedReason = mock(() => Promise.resolve(2));

      expect(await service.shouldPromptSave(GUILD_ID, "Spam")).toBe(false);
    });

    test("false when a template already has the content", async () => {
      repository.findByContentKey = mock(() => Promise.resolve(makeTemplate()));
      modLogReasons.countByNormalizedReason = mock(() => Promise.resolve(3));

      expect(
        await service.shouldPromptSave(GUILD_ID, "Spamming in chat."),
      ).toBe(false);
    });

    test("false for an empty reason", async () => {
      expect(await service.shouldPromptSave(GUILD_ID, null)).toBe(false);
      expect(modLogReasons.countByNormalizedReason).not.toHaveBeenCalled();
    });
  });
});
