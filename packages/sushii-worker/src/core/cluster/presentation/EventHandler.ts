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

  abstract handle(...data: EventArgs<T>): Promise<void>;
}
