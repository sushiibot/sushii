import customIds from "@/interactions/customIds";

import type { ModerationCase } from "../../domain/entities/ModerationCase";

export type ModLogDmConfirmAction = "deleteConfirm" | "cancel";

const DM_CONFIRM_PREFIX = "modLog/dm/";

export function buildModLogReasonButtonId(caseId: string): string {
  return customIds.modLogReason.compile({ caseId });
}

/**
 * Same format as the legacy Delete DM button, so old and new mod log
 * messages route to one handler.
 */
export function buildModLogDeleteDmButtonId(
  moderationCase: ModerationCase,
): string | null {
  const channelId = moderationCase.dmResult?.channelId;
  const messageId = moderationCase.dmResult?.messageId;
  if (!channelId || !messageId) {
    return null;
  }

  return customIds.modLogDeleteReasonDM.compile({
    caseId: moderationCase.caseId,
    channelId,
    messageId,
  });
}

export function buildModLogDmConfirmId(
  action: ModLogDmConfirmAction,
  caseId: string,
): string {
  return `${DM_CONFIRM_PREFIX}${action}/${caseId}`;
}

export function parseModLogDmConfirmId(
  customId: string,
): { action: ModLogDmConfirmAction; caseId: string } | null {
  const match = /^modLog\/dm\/(deleteConfirm|cancel)\/(\d+)$/.exec(customId);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return { action: match[1] as ModLogDmConfirmAction, caseId: match[2] };
}

export type ModLogDmButton =
  | { action: "delete"; caseId: string }
  | { action: ModLogDmConfirmAction; caseId: string };

export function parseModLogDmButtonId(customId: string): ModLogDmButton | null {
  const legacy = customIds.modLogDeleteReasonDM.matchParams(customId);
  if (legacy) {
    return { action: "delete", caseId: legacy.caseId };
  }

  return parseModLogDmConfirmId(customId);
}

/** Fits MessageComponentHandler.customIDMatch, which the router calls with the customId. */
export function matchModLogDmButtonId(
  customId: string,
): { path: string; index: number; params: ModLogDmButton } | false {
  const params = parseModLogDmButtonId(customId);

  return params ? { path: customId, index: 0, params } : false;
}
