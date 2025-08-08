import type { ClientEvents, Events, GatewayDispatchPayload } from "discord.js";
import type { Client } from "discord.js";

export type RawEventHandlerFn<T extends Events> = (
  client: Client,
  eventType: T,
  payload: GatewayDispatchPayload,
) => Promise<void>;

export type EventHandlerFn<K extends keyof ClientEvents> = (
  ...data: ClientEvents[K]
) => Promise<void>;
