import { WebhookClient } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { ProductEventTracker } from "@/features/product-analytics/domain/ProductEvent";
import type * as schema from "@/infrastructure/database/schema";

import { FeedbackService } from "./application/FeedbackService";
import { DrizzleFeedbackRepository } from "./infrastructure/DrizzleFeedbackRepository";
import { FeedbackMetrics } from "./infrastructure/FeedbackMetrics";
import { FeedbackWebhookPublisher } from "./infrastructure/FeedbackWebhookPublisher";
import { FeedbackButtonHandler } from "./presentation/handlers/FeedbackButtonHandler";
import { FeedbackModalHandler } from "./presentation/handlers/FeedbackModalHandler";

export interface FeedbackFeature {
  buttonHandlers: [FeedbackButtonHandler];
  modalHandlers: [FeedbackModalHandler];
}

export interface FeedbackFeatureOptions {
  db: NodePgDatabase<typeof schema>;
  webhookUrl: string | undefined;
  logger: Logger;
  productEvents: ProductEventTracker;
}

export function setupFeedbackFeature({
  db,
  webhookUrl,
  logger,
  productEvents,
}: FeedbackFeatureOptions): FeedbackFeature {
  const feedbackService = new FeedbackService(
    new DrizzleFeedbackRepository(db),
    new FeedbackWebhookPublisher(
      webhookUrl ? new WebhookClient({ url: webhookUrl }) : null,
      logger.child({ component: "FeedbackWebhookPublisher" }),
    ),
    new FeedbackMetrics(),
    logger.child({ component: "FeedbackService" }),
    productEvents,
  );

  return {
    buttonHandlers: [new FeedbackButtonHandler()],
    modalHandlers: [new FeedbackModalHandler(feedbackService)],
  };
}
