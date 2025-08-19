import type { ClientEvents, GatewayDispatchPayload } from "discord.js";
import type { Events } from "discord.js";

export type EventType = keyof ClientEvents | Events.Raw;

export type EventArgs<T> = T extends keyof ClientEvents
  ? ClientEvents[T]
  : T extends Events.Raw
    ? [GatewayDispatchPayload]
    : never;

export abstract class EventHandler<T extends EventType> {
  abstract readonly eventType: T;

  /**
   * Whether this handler should be exempt from deployment active checks.
   * If true, the handler will always run regardless of deployment status.
   * Defaults to false for backward compatibility.
   */
  readonly isExemptFromDeploymentCheck: boolean = false;

  abstract handle(...data: EventArgs<T>): Promise<void>;
}
