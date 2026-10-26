import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type {
  FeedbackFeatureKey,
  FeedbackKind,
  FeedbackPublisher,
  FeedbackReporter,
  FeedbackRepository,
  FeedbackSource,
  PublishOutcome,
} from "../domain/Feedback";
import type { FeedbackMetrics } from "../infrastructure/FeedbackMetrics";

export const FEEDBACK_RATE_LIMIT = 3;
export const FEEDBACK_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

export interface FeedbackSubmission {
  source: FeedbackSource;
  kind: FeedbackKind;
  feature: FeedbackFeatureKey | null;
  traceId: string | null;
  userId: string;
  guildId: string | null;
  content: string;
  reporter: FeedbackReporter;
}

export class FeedbackService {
  constructor(
    private readonly repository: FeedbackRepository,
    private readonly publisher: FeedbackPublisher,
    private readonly metrics: FeedbackMetrics,
    private readonly logger: Logger,
  ) {}

  async submit(
    input: FeedbackSubmission,
  ): Promise<Result<void, "rate_limited">> {
    const attributes = {
      source: input.source,
      kind: input.kind,
      feature: input.feature ?? "none",
    };

    const feedback = await this.repository.insertWithinLimit(
      {
        userId: input.userId,
        guildId: input.guildId,
        source: input.source,
        kind: input.kind,
        feature: input.feature,
        traceId: input.traceId,
        content: input.content,
      },
      FEEDBACK_RATE_LIMIT,
      FEEDBACK_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!feedback) {
      this.metrics.submissions.add(1, {
        ...attributes,
        outcome: "rate_limited",
      });
      return Err("rate_limited");
    }

    let published: PublishOutcome;
    try {
      published = await this.publisher.publish(feedback, input.reporter);
    } catch (err) {
      this.metrics.submissions.add(1, {
        ...attributes,
        outcome: "publish_failed",
      });
      // The row is the record of truth; a missed staff post must not fail the submit.
      this.logger.warn(
        {
          err,
          feedbackId: feedback.id,
          outcome: "publish_failed",
          ...attributes,
        },
        "Failed to publish feedback",
      );
      return Ok.EMPTY;
    }

    this.metrics.submissions.add(1, {
      ...attributes,
      outcome: published === "published" ? "submitted" : published,
    });
    return Ok.EMPTY;
  }
}
