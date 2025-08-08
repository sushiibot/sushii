import { DomainEvent } from "@/shared/domain/DomainEvent";

import type { DeploymentName } from "../entities/Deployment";

export class DeploymentChanged extends DomainEvent {
  constructor(
    public readonly previousDeployment: DeploymentName,
    public readonly newDeployment: DeploymentName,
  ) {
    super();
  }

  readonly eventName = "DeploymentChanged";
}
