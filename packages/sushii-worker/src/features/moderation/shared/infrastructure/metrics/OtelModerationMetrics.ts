import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Meter } from "@opentelemetry/api";

import type {
  ActionResponseButtonKind,
  ActionResponseButtonOutcome,
  ModLogEditKind,
  ModLogEditOutcome,
  ModerationMetrics,
  ReasonSource,
  ReasonSurface,
  SavePromptEvent,
  TemplateChangeAction,
  TemplateChangeOrigin,
  TemplateChangeOutcome,
} from "../../domain/metrics/ModerationMetrics";
import { MOD_LOG_EDIT_KINDS } from "../../domain/metrics/ModerationMetrics";

export const MODERATION_METER_NAME = "moderation";

export function moderationMeter(): Meter {
  return metrics.getMeter(MODERATION_METER_NAME, "1.0");
}

/** No guild or user attributes: they would multiply series per guild. */
export class OtelModerationMetrics implements ModerationMetrics {
  private readonly reasonResolved: Counter;
  private readonly templateChange: Counter;
  private readonly savePrompt: Counter;
  private readonly actionResponseButton: Counter;
  private readonly modLogEdit: Counter;

  constructor(meter: Meter = moderationMeter()) {
    this.reasonResolved = meter.createCounter("moderation.reason.resolved", {
      description: "Reasons submitted by moderators, by surface and source",
      valueType: ValueType.INT,
    });
    this.templateChange = meter.createCounter(
      "moderation.reason_template.change",
      {
        description: "Reason template creates, updates and deletes",
        valueType: ValueType.INT,
      },
    );
    this.savePrompt = meter.createCounter(
      "moderation.reason_template.save_prompt",
      {
        description: "Save as template prompts shown and clicked",
        valueType: ValueType.INT,
      },
    );
    this.actionResponseButton = meter.createCounter(
      "moderation.action_response.button",
      {
        description: "Clicks on mod action response buttons, by outcome",
        valueType: ValueType.INT,
      },
    );
    this.modLogEdit = meter.createCounter("moderation.modlog.edit", {
      description: "Mod log entry and moderation DM edits, by outcome",
      valueType: ValueType.INT,
    });

    // increase() can't see a series' first sample, so the failure alert needs them to exist at 0.
    for (const kind of MOD_LOG_EDIT_KINDS) {
      this.modLogEdit.add(0, { kind, outcome: "failed" });
    }
  }

  recordReasonResolved(surface: ReasonSurface, source: ReasonSource): void {
    this.reasonResolved.add(1, { surface, source });
  }

  recordTemplateChange(
    action: TemplateChangeAction,
    origin: TemplateChangeOrigin,
    outcome: TemplateChangeOutcome,
  ): void {
    this.templateChange.add(1, { action, origin, outcome });
  }

  recordSavePrompt(event: SavePromptEvent): void {
    this.savePrompt.add(1, { event });
  }

  recordActionResponseButton(
    button: ActionResponseButtonKind,
    outcome: ActionResponseButtonOutcome,
  ): void {
    this.actionResponseButton.add(1, { button, outcome });
  }

  recordModLogEdit(kind: ModLogEditKind, outcome: ModLogEditOutcome): void {
    this.modLogEdit.add(1, { kind, outcome });
  }
}
