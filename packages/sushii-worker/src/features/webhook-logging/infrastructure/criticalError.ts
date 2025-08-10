import logger from "@/shared/infrastructure/logger";

import { WebhookService } from "./WebhookService";

// Singleton service for critical error reporting
let criticalErrorService: WebhookService | null = null;

export function initializeCriticalErrorService(): void {
  criticalErrorService = new WebhookService(logger);
}

export async function reportCriticalError(
  title: string,
  message: string,
): Promise<void> {
  if (!criticalErrorService) {
    logger.warn("Critical error service not initialized, skipping webhook error");
    return;
  }

  await criticalErrorService.logError(title, message);
}