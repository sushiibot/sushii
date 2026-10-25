import { ValueType, metrics } from "@opentelemetry/api";
import type { Attributes, Counter } from "@opentelemetry/api";

import type {
  CheckResult,
  ScreeningMetrics,
} from "../../domain/ScreeningMetrics";
import type { IgnoreReason, VerdictKind } from "../../domain/types";

/** No guild id attribute: it would multiply series per screened guild. */
export class OtelScreeningMetrics implements ScreeningMetrics {
  private readonly checkCounter: Counter;
  private readonly costCounter: Counter;
  private readonly outcomeCounter: Counter;

  constructor() {
    const meter = metrics.getMeter("member-screening", "1.0");

    this.checkCounter = meter.createCounter("member_screening.check", {
      description: "Member screening checks by kind and result",
      valueType: ValueType.INT,
    });

    this.costCounter = meter.createCounter("member_screening.cost", {
      description: "OpenRouter cost of member screening checks, in US dollars",
      valueType: ValueType.DOUBLE,
      unit: "USD",
    });

    this.outcomeCounter = meter.createCounter("member_screening.outcome", {
      description: "Moderator outcomes for screened members",
      valueType: ValueType.INT,
    });
  }

  recordCheck(kind: VerdictKind, result: CheckResult, cost: number | null) {
    this.checkCounter.add(1, { kind, result });
    if (cost !== null && cost > 0) {
      this.costCounter.add(cost, { kind });
    }
  }

  recordOutcome(
    outcome: "actioned" | "ignored" | "missed",
    detail: { source: "button" | "audit_log"; reason?: IgnoreReason },
  ) {
    const attributes: Attributes = { outcome, source: detail.source };
    if (detail.reason) {
      attributes.reason = detail.reason;
    }
    this.outcomeCounter.add(1, attributes);
  }
}
