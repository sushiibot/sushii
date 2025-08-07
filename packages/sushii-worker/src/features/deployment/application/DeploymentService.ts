import { Logger } from "pino";

import { DeploymentConfig } from "@/shared/infrastructure/config/config";

import { Deployment, DeploymentName } from "../domain/entities/Deployment";
import { DeploymentChanged } from "../domain/events/DeploymentChanged";
import { DeploymentRepository } from "../domain/repositories/DeploymentRepository";

export class DeploymentService {
  private currentDeployment: Deployment | null = null;
  private readonly processName: DeploymentName;
  private isStarted = false;
  private lastInactiveLogTime = 0;

  constructor(
    private readonly repository: DeploymentRepository,
    private readonly logger: Logger,
    processName: DeploymentName,
    private readonly deploymentConfig: DeploymentConfig,
  ) {
    this.processName = processName;
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn("Deployment service already started");
      return;
    }

    try {
      await this.repository.start();
      this.currentDeployment = await this.repository.getActive();
      this.isStarted = true;

      this.logger.info(
        {
          active: this.currentDeployment.name,
          process: this.processName,
          isActive: this.isCurrentDeploymentActive(),
        },
        "Deployment service started",
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to start deployment service");
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      await this.repository.stop();
      this.isStarted = false;
      this.currentDeployment = null;
      this.logger.info("Deployment service stopped");
    } catch (err) {
      this.logger.error({ err }, "Error stopping deployment service");
    }
  }

  getCurrentDeployment(): DeploymentName {
    if (!this.currentDeployment) {
      this.logger.warn("Deployment service not initialized, returning default");
      return "blue"; // Default fallback
    }

    return this.currentDeployment.name;
  }

  isChannelExemptFromDeploymentCheck(channelId?: string | null): boolean {
    if (!channelId || !this.deploymentConfig.hasExemptChannels) {
      return false;
    }

    return this.deploymentConfig.exemptChannelIds.has(channelId);
  }

  isCurrentDeploymentActive(channelId?: string | null): boolean {
    if (!this.currentDeployment) {
      this.logger.warn("No active deployment found, cannot check if active");

      return false;
    }

    // Check if channel is exempt from deployment checks
    if (this.isChannelExemptFromDeploymentCheck(channelId)) {
      this.logger.debug(
        {
          channelId,
          processDeployment: this.processName,
          activeDeployment: this.currentDeployment.name,
        },
        "Channel is exempt from deployment check, allowing processing",
      );

      return true;
    }

    const isActive = this.currentDeployment.isActive(this.processName);

    if (!isActive) {
      // Only log max once per 30 seconds to reduce noise
      const now = Date.now();

      if (now - this.lastInactiveLogTime > 30000) {
        this.lastInactiveLogTime = now;
        this.logger.warn(
          {
            activeDeployment: this.currentDeployment.name,
            processDeployment: this.processName,
            channelId,
          },
          "Current process is NOT active deployment, will not process events",
        );
      }
    }

    return isActive;
  }

  async setActiveDeployment(
    targetDeployment: DeploymentName,
  ): Promise<{ changed: boolean; deployment: DeploymentName }> {
    if (!this.currentDeployment) {
      throw new Error("Deployment service not initialized");
    }

    const previousName = this.currentDeployment.name;

    // Check if already set to target
    if (previousName === targetDeployment) {
      this.logger.info(
        { deployment: targetDeployment },
        "Deployment already set to target, no change needed",
      );
      return { changed: false, deployment: targetDeployment };
    }

    const newDeployment = this.currentDeployment.setTo(targetDeployment);

    try {
      // Repository will handle database update and PostgreSQL NOTIFY
      await this.repository.setActive(newDeployment);
      this.currentDeployment = newDeployment;

      this.logger.info(
        {
          from: previousName,
          to: newDeployment.name,
          isNowActive: this.isCurrentDeploymentActive(),
        },
        "Deployment set successfully",
      );

      return { changed: true, deployment: newDeployment.name };
    } catch (err) {
      this.logger.error({ err }, "Failed to set deployment");
      throw err;
    }
  }

  handleDeploymentChanged(event: DeploymentChanged): void {
    const previousDeployment = this.currentDeployment?.name;
    this.currentDeployment = Deployment.create(event.newDeployment);

    const wasActive = previousDeployment === this.processName;
    const isNowActive = this.isCurrentDeploymentActive();

    this.logger.info(
      {
        previousDeployment,
        newDeployment: event.newDeployment,
        wasActive,
        isNowActive,
        processDeployment: this.processName,
      },
      "Deployment state updated from notification",
    );

    if (wasActive && !isNowActive) {
      this.logger.warn(
        "This deployment is no longer active - will stop processing events",
      );
    } else if (!wasActive && isNowActive) {
      this.logger.info(
        "This deployment is now active - will start processing events",
      );
    }
  }
}
