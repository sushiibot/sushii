import type { WebhookService } from "./WebhookService";

export class CriticalErrorService {
  constructor(private readonly webhookService: WebhookService) {}

  async logCriticalError(title: string, message: string): Promise<void> {
    await this.webhookService.logError(title, message);
  }
}
