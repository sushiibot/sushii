import { describe, expect, it } from "bun:test";

import { AltNicknameButtonHandler } from "@/features/alt-accounts/presentation/handlers/AltNicknameButtonHandler";
import { ScamCandidateButtonHandler } from "@/features/automod/presentation/handlers/ScamCandidateButtonHandler";
import { ScamCandidateLabelModalHandler } from "@/features/automod/presentation/handlers/ScamCandidateLabelModalHandler";
import { ScamHashReportButtonHandler } from "@/features/automod/presentation/handlers/ScamHashReportButtonHandler";
import { GiveawayButtonHandler } from "@/features/giveaways/presentation/components/GiveawayButtonHandler";
import { AutomodAlertActionButtonHandler } from "@/features/moderation/actions/presentation/components/AutomodAlertActionButtonHandler";
import { AutomodAlertRemoveTimeoutButtonHandler } from "@/features/moderation/actions/presentation/components/AutomodAlertRemoveTimeoutButtonHandler";
import { ModLogDeleteDMButtonHandler } from "@/features/moderation/audit-logs/presentation/components/ModLogDeleteDMButtonHandler";
import { ModLogReasonButtonHandler } from "@/features/moderation/audit-logs/presentation/components/ModLogReasonButtonHandler";
import { PromptButtonHandler } from "@/features/prompts/presentation/handlers/PromptButtonHandler";
import { RoleMenuButtonHandler } from "@/features/role-menu/presentation/handlers/RoleMenuButtonHandler";
import { RoleMenuSelectMenuHandler } from "@/features/role-menu/presentation/handlers/RoleMenuSelectMenuHandler";
import { ScheduleConfigDeleteButtonHandler } from "@/features/schedule/presentation/handlers/ScheduleConfigDeleteButtonHandler";
import { ScheduleConfigNewButtonHandler } from "@/features/schedule/presentation/handlers/ScheduleConfigNewButtonHandler";
import type {
  ButtonHandler,
  ModalHandler,
  SelectMenuHandler,
} from "@/shared/presentation/handlers";

import { MODVIEW_CUSTOM_IDS } from "./customIds";

/**
 * Every button/select/modal handler that `InteractionRouter` routes globally,
 * built the same way it consumes them: `handlers.find(h =>
 * h.customIDMatch(id) !== false)`.
 *
 * Every constructor here is `super()` + param-property assignment with no
 * side effects, and every `customIDMatch` field is a module-scope closure
 * that reads only its `customId` argument — never `this` or a constructor
 * arg — so constructing with placeholder dependencies is safe and yields the
 * real, shipped matcher rather than a stand-in.
 */
function buildRegisteredHandlers(): (
  | ButtonHandler
  | SelectMenuHandler
  | ModalHandler
)[] {
  const dep = {} as never;

  return [
    new AltNicknameButtonHandler(dep, dep),
    new ScamCandidateButtonHandler(dep),
    new ScamCandidateLabelModalHandler(dep),
    new ScamHashReportButtonHandler(dep, dep),
    new GiveawayButtonHandler(dep, dep, dep, dep, dep),
    new AutomodAlertActionButtonHandler(dep, dep),
    new AutomodAlertRemoveTimeoutButtonHandler(dep, dep),
    new ModLogDeleteDMButtonHandler(dep, dep),
    new ModLogReasonButtonHandler(dep, dep),
    new PromptButtonHandler(dep, dep),
    new RoleMenuButtonHandler(dep, dep, dep, dep),
    new RoleMenuSelectMenuHandler(dep, dep, dep, dep),
    new ScheduleConfigDeleteButtonHandler(dep, dep, dep),
    new ScheduleConfigNewButtonHandler(dep, dep, dep),
  ];
}

describe("modview_ custom IDs vs globally-routed handlers", () => {
  const handlers = buildRegisteredHandlers();
  const modviewIds = [
    ...Object.values(MODVIEW_CUSTOM_IDS),
    // The nickname modal actually transmits this suffixed form
    // (`ModViewSession.ts`'s `renameIdentity`), not the bare literal above —
    // a prefix or path-to-regexp matcher could claim the suffix while
    // missing the bare ID this loop otherwise checks.
    `${MODVIEW_CUSTOM_IDS.altsNicknameModal}:123456789012345678`,
  ];

  it("enumerates every registered button/select/modal handler", () => {
    // Guards against the array above silently shrinking (e.g. a bad merge)
    // and the whole suite passing vacuously with zero handlers.
    expect(handlers.length).toBeGreaterThanOrEqual(14);
  });

  it("positive control: a real inline-closure matcher still claims its own ID", () => {
    const altHandler = handlers.find(
      (h) => h instanceof AltNicknameButtonHandler,
    );
    expect(altHandler?.customIDMatch("alts:nickname:1")).not.toBe(false);
  });

  it("positive control: a real path-to-regexp matcher still claims its own ID", () => {
    const modLogReasonHandler = handlers.find(
      (h) => h instanceof ModLogReasonButtonHandler,
    );
    // ModLogReasonButtonHandler's matcher is `customIds.modLogReason.match`,
    // built via path-to-regexp against "/modlog/reason/:caseId" — a
    // different matcher flavor than the hand-rolled parsers above.
    expect(modLogReasonHandler?.customIDMatch("/modlog/reason/123")).not.toBe(
      false,
    );
  });

  for (const modviewId of modviewIds) {
    it(`no registered handler claims "${modviewId}"`, () => {
      for (const handler of handlers) {
        const result = handler.customIDMatch(modviewId);
        expect(result).toBe(false);
      }
    });
  }
});
