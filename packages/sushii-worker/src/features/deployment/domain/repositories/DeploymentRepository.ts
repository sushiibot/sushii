import type { Deployment } from "../entities/Deployment";

export interface DeploymentRepository {
  getActive(): Promise<Deployment>;
  setActive(deployment: Deployment): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
