export abstract class DomainEvent {
  public readonly occurredAt: Date;
  public abstract readonly eventName: string;

  constructor() {
    this.occurredAt = new Date();
  }
}
