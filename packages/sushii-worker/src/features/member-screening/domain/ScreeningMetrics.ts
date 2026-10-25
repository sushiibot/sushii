import type { IgnoreReason, VerdictKind } from "./types";

export type CheckResult =
  | "clean"
  | "flagged"
  | "error"
  | "skipped_trivial"
  | "skipped_cap";

export interface ScreeningMetrics {
  recordCheck(
    kind: VerdictKind,
    result: CheckResult,
    cost: number | null,
  ): void;
  recordOutcome(
    outcome: "actioned" | "ignored" | "missed",
    detail: { source: "button" | "audit_log"; reason?: IgnoreReason },
  ): void;
}
