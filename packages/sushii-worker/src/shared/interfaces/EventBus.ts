import type { DomainEvent } from "../domain/DomainEvent";

export interface EventBus {
  publish<T extends DomainEvent>(event: T): Promise<void>;
  subscribe<T extends DomainEvent>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventType: new (...args: any[]) => T,
    handler: (event: T) => void,
  ): void;
}
