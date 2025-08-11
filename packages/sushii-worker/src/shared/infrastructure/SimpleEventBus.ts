import type { DomainEvent } from "../domain/DomainEvent";
import type { EventBus } from "../interfaces/EventBus";

export class SimpleEventBus implements EventBus {
  private readonly handlers = new Map<
    string,
    ((event: DomainEvent) => void)[]
  >();

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const eventName = event.constructor.name;
    const eventHandlers = this.handlers.get(eventName) || [];

    for (const handler of eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${eventName}:`, error);
      }
    }
  }

  subscribe<T extends DomainEvent>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventType: new (...args: any[]) => T,
    handler: (event: T) => void,
  ): void {
    const eventName = eventType.name;
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler as (event: DomainEvent) => void);
    this.handlers.set(eventName, handlers);
  }
}
