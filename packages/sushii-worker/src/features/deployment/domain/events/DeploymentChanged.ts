import { DeploymentName } from "../entities/Deployment";
import { DomainEvent } from "../../../../shared/domain/DomainEvent";

export class DeploymentChanged extends DomainEvent {
  constructor(
    public readonly previousDeployment: DeploymentName,
    public readonly newDeployment: DeploymentName
  ) {
    super();
  }

  readonly eventName = "DeploymentChanged";
}