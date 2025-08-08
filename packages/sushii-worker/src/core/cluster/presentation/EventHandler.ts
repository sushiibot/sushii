import type { ClientEvents } from "discord.js";

export abstract class EventHandler<T extends keyof ClientEvents> {
  abstract readonly eventType: T;

  abstract handle(...data: ClientEvents[T]): Promise<void>;
}
