import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";

import type {
  Feedback,
  FeedbackPublisher,
  FeedbackRepository,
} from "../domain/Feedback";
import type { FeedbackMetrics } from "../infrastructure/FeedbackMetrics";
import type { FeedbackSubmission } from "./FeedbackService";
import { FEEDBACK_RATE_LIMIT, FeedbackService } from "./FeedbackService";

const SUBMISSION: FeedbackSubmission = {
  source: "panel",
  kind: "idea",
  feature: "settings.logging",
  traceId: null,
  userId: "150443906511667200",
  guildId: "167058919611564043",
  content: "Separate channels for bans and timeouts please",
  reporter: { username: "tzuyu", guildName: "ONCE" },
};

const SAVED: Feedback = {
  id: 1,
  userId: SUBMISSION.userId,
  guildId: SUBMISSION.guildId,
  source: SUBMISSION.source,
  kind: SUBMISSION.kind,
  feature: SUBMISSION.feature,
  traceId: null,
  content: SUBMISSION.content,
  createdAt: new Date("2026-10-26T12:00:00Z"),
};

describe("FeedbackService", () => {
  let repository: {
    insertWithinLimit: ReturnType<typeof mock>;
  };
  let publisher: { publish: ReturnType<typeof mock> };
  let add: ReturnType<typeof mock>;
  let warn: ReturnType<typeof mock>;
  let service: FeedbackService;

  beforeEach(() => {
    repository = {
      insertWithinLimit: mock(() => Promise.resolve(SAVED)),
    };
    publisher = { publish: mock(() => Promise.resolve("published")) };
    add = mock(() => undefined);
    warn = mock(() => undefined);

    const metrics = Object.create(null) as FeedbackMetrics;
    Object.assign(metrics, { submissions: { add } });
    const logger = { warn } as unknown as Logger;

    service = new FeedbackService(
      repository as unknown as FeedbackRepository,
      publisher as unknown as FeedbackPublisher,
      metrics,
      logger,
    );
  });

  test("stores within the limit over the last hour and publishes", async () => {
    const result = await service.submit(SUBMISSION);

    expect(result.ok).toBe(true);
    expect(repository.insertWithinLimit).toHaveBeenCalledWith(
      {
        userId: SUBMISSION.userId,
        guildId: SUBMISSION.guildId,
        source: "panel",
        kind: "idea",
        feature: "settings.logging",
        traceId: null,
        content: SUBMISSION.content,
      },
      FEEDBACK_RATE_LIMIT,
      60 * 60,
    );
    expect(publisher.publish).toHaveBeenCalledWith(SAVED, SUBMISSION.reporter);
    expect(add).toHaveBeenCalledWith(1, {
      source: "panel",
      kind: "idea",
      feature: "settings.logging",
      outcome: "submitted",
    });
  });

  test("returns rate_limited when the repository refuses the insert", async () => {
    repository.insertWithinLimit.mockResolvedValue(null);

    const result = await service.submit(SUBMISSION);

    expect(result.err).toBe(true);
    expect(result.val).toBe("rate_limited");
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(1, {
      source: "panel",
      kind: "idea",
      feature: "settings.logging",
      outcome: "rate_limited",
    });
  });

  test("records not_configured when the webhook is unset", async () => {
    publisher.publish.mockResolvedValue("not_configured");

    const result = await service.submit(SUBMISSION);

    expect(result.ok).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, {
      source: "panel",
      kind: "idea",
      feature: "settings.logging",
      outcome: "not_configured",
    });
  });

  test("keeps the row and succeeds when the webhook throws", async () => {
    const error = new Error("webhook down");
    publisher.publish.mockRejectedValue(error);

    const result = await service.submit({
      ...SUBMISSION,
      source: "error_report",
      kind: "broken",
      feature: null,
    });

    expect(result.ok).toBe(true);
    expect(repository.insertWithinLimit).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, feedbackId: SAVED.id }),
      "Failed to publish feedback",
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, {
      source: "error_report",
      kind: "broken",
      feature: "none",
      outcome: "publish_failed",
    });
  });
});
