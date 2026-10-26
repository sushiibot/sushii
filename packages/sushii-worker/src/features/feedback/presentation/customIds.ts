import { isValidTraceId } from "@opentelemetry/api";

import type { FeedbackFeatureKey } from "../domain/Feedback";
import { isFeedbackFeature } from "../domain/Feedback";

const PREFIX = "feedback/";
const NO_TRACE = "-";
const TRACE = "[0-9a-f]{32}";
const NONCE = "[0-9a-f]{8}";
const FEATURE = "[a-z.-]+";
const SNOWFLAKE = "\\d{17,20}";

const TRACE_ID_RE = new RegExp(`^${TRACE}$`);
const SNOWFLAKE_RE = new RegExp(`^${SNOWFLAKE}$`);
const ERROR_BUTTON_RE = new RegExp(
  `^feedback/error/(${TRACE}|${NO_TRACE})/(${SNOWFLAKE})$`,
);
/** The fallback for an invalid invoker ID, which never carries a trace. */
const UNATTRIBUTED_ERROR_BUTTON_ID = `${PREFIX}error`;
const PANEL_BUTTON_RE = new RegExp(`^feedback/panel/(${FEATURE})$`);
const ERROR_MODAL_RE = new RegExp(
  `^feedback/modal/error/(${TRACE}|${NO_TRACE})/(${NONCE})$`,
);
const PANEL_MODAL_RE = new RegExp(
  `^feedback/modal/panel/(${FEATURE})/(${NONCE})$`,
);

export type FeedbackTarget =
  | { source: "error_report"; traceId: string | null }
  | { source: "panel"; feature: FeedbackFeatureKey };

export type FeedbackButtonId =
  | { source: "error_report"; traceId: string | null; invokerId: string | null }
  | { source: "panel"; feature: FeedbackFeatureKey };

export type FeedbackModalId = FeedbackTarget & { nonce: string };

export function isFeedbackCustomId(customId: string): boolean {
  return customId.startsWith(PREFIX);
}

/** Only well-formed OTel trace IDs are embedded; anything else is dropped. */
function normalizeTraceId(traceId: string | null | undefined): string | null {
  if (!traceId || !TRACE_ID_RE.test(traceId) || !isValidTraceId(traceId)) {
    return null;
  }

  return traceId;
}

/** `invokerId` is the user whose interaction errored; only they get the trace attached. */
export function buildErrorButtonId(
  invokerId: string,
  traceId?: string | null,
): string {
  if (!SNOWFLAKE_RE.test(invokerId)) {
    return UNATTRIBUTED_ERROR_BUTTON_ID;
  }

  const trace = normalizeTraceId(traceId) ?? NO_TRACE;
  return `${PREFIX}error/${trace}/${invokerId}`;
}

export function buildPanelButtonId(feature: FeedbackFeatureKey): string {
  return `${PREFIX}panel/${feature}`;
}

function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** New nonce on every call so Discord doesn't restore a stale draft. */
export function buildModalId(id: FeedbackTarget): string {
  if (id.source === "error_report") {
    const trace = normalizeTraceId(id.traceId) ?? NO_TRACE;
    return `${PREFIX}modal/error/${trace}/${newNonce()}`;
  }

  return `${PREFIX}modal/panel/${id.feature}/${newNonce()}`;
}

export function parseButtonId(customId: string): FeedbackButtonId | null {
  const error = ERROR_BUTTON_RE.exec(customId);
  if (error && (error[1] === NO_TRACE || isValidTraceId(error[1]))) {
    return {
      source: "error_report",
      traceId: error[1] === NO_TRACE ? null : error[1],
      invokerId: error[2],
    };
  }

  if (customId === UNATTRIBUTED_ERROR_BUTTON_ID) {
    return { source: "error_report", traceId: null, invokerId: null };
  }

  const panel = PANEL_BUTTON_RE.exec(customId);
  if (panel && isFeedbackFeature(panel[1])) {
    return { source: "panel", feature: panel[1] };
  }

  return null;
}

export function parseModalId(customId: string): FeedbackModalId | null {
  const error = ERROR_MODAL_RE.exec(customId);
  if (error && (error[1] === NO_TRACE || isValidTraceId(error[1]))) {
    return {
      source: "error_report",
      traceId: error[1] === NO_TRACE ? null : error[1],
      nonce: error[2],
    };
  }

  const panel = PANEL_MODAL_RE.exec(customId);
  if (panel && isFeedbackFeature(panel[1])) {
    return { source: "panel", feature: panel[1], nonce: panel[2] };
  }

  return null;
}
