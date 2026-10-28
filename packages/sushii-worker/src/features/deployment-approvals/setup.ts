import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { config, secrets } from "@/shared/infrastructure/config";
import { env } from "@/shared/infrastructure/config/env";

import { ApprovalClient } from "./client";
import { DeploymentApprovalButtonHandler } from "./handler";
import { DeploymentApprovalPublisher } from "./publisher";

export function setupDeploymentApprovals(
  client: Client,
  deployment: DeploymentService,
  logger: Logger,
) {
  const url = env.DEPLOY_APPROVAL_URL;
  const token = secrets.DEPLOY_APPROVAL_TOKEN;
  if (!url && !token) return { buttonHandlers: [] };
  if (!url || !token || !config.deployment.ownerUserId)
    throw new Error("Deployment approvals require URL, token and owner");
  const api = new ApprovalClient(url, token);
  if (client.cluster.id === 0) {
    const publisher = new DeploymentApprovalPublisher(
      api,
      client,
      deployment,
      logger,
    );
    process.once("SIGTERM", () => publisher.stop());
    process.once("SIGINT", () => publisher.stop());
    void publisher
      .run()
      .catch((err) =>
        logger.error({ err }, "Deployment approval publisher stopped"),
      );
  }
  return {
    buttonHandlers: [
      new DeploymentApprovalButtonHandler(api, config.deployment.ownerUserId),
    ],
  };
}
