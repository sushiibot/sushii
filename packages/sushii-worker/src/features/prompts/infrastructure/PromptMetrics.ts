import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

export type PromptSkipReason = "cap" | "send_failed";
export type PromptAction = "snooze" | "dismiss" | (string & {});

export class PromptMetrics {
  private readonly shown: Counter;
  private readonly skipped: Counter;
  private readonly actions: Counter;

  constructor() {
    const meter = metrics.getMeter("prompts", "1.0");

    this.shown = meter.createCounter("prompts.shown", {
      description: "Prompts shown, by prompt",
      valueType: ValueType.INT,
    });
    this.skipped = meter.createCounter("prompts.skipped", {
      description: "Eligible prompts not shown, by prompt and reason",
      valueType: ValueType.INT,
    });
    this.actions = meter.createCounter("prompts.action", {
      description: "Prompt button and select actions, by prompt and action",
      valueType: ValueType.INT,
    });
  }

  recordShown(prompt: string): void {
    this.shown.add(1, { prompt });
  }

  recordSkipped(prompt: string, reason: PromptSkipReason): void {
    this.skipped.add(1, { prompt, reason });
  }

  recordAction(prompt: string, action: PromptAction): void {
    this.actions.add(1, { prompt, action });
  }
}
