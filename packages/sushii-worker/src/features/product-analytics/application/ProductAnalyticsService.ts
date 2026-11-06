import type { Logger } from "pino";

import type {
  ProductAnalyticsRepository,
  UserDataDeletion,
} from "../domain/ProductAnalyticsRepository";
import {
  type ProductEventInput,
  type ProductEventTracker,
  actorCode,
  featureForEvent,
} from "../domain/ProductEvent";

/** Beyond this the database is struggling; dropping events beats queueing them. */
const MAX_PENDING_INSERTS = 100;

export class ProductAnalyticsService implements ProductEventTracker {
  private pendingInserts = 0;

  constructor(
    private readonly repository: ProductAnalyticsRepository,
    /** Unset turns tracking off, so the bot can ship before the secret exists. */
    private readonly key: string | undefined,
    private readonly logger: Logger,
  ) {}

  track(event: ProductEventInput): void {
    const { key } = this;
    if (!key || this.pendingInserts >= MAX_PENDING_INSERTS) {
      return;
    }

    this.pendingInserts += 1;
    this.repository
      .insert({
        name: event.name,
        feature: featureForEvent(event),
        guildId: event.guildId ? BigInt(event.guildId) : null,
        actor: event.userId ? actorCode(key, event.userId) : null,
        props: event.props ?? {},
      })
      .catch((err: unknown) => {
        this.logger.warn(
          { err, eventName: event.name },
          "Failed to record product event",
        );
      })
      .finally(() => {
        this.pendingInserts -= 1;
      });
  }

  /** Staff channel posts for this user's feedback have to be removed by hand. */
  async deleteUserData(userId: string): Promise<UserDataDeletion> {
    if (!this.key) {
      throw new Error("PRODUCT_ANALYTICS_KEY is needed to find usage records");
    }
    return this.repository.deleteUserData(userId, actorCode(this.key, userId));
  }
}
