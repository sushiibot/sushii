import * as Sentry from "@sentry/node";
import { CronJob } from "cron";
import type { Client } from "discord.js";

import logger from "@/shared/infrastructure/logger";
import type { AbstractBackgroundTask } from "@/tasks/AbstractBackgroundTask";

export function registerTasks(
  client: Client,
  featureTasks: AbstractBackgroundTask[],
): void {
  const isCluster0 = client.cluster.shardList.includes(0);

  // Only run background tasks on shard 0 to avoid duplication
  if (!isCluster0) {
    logger.info(
      {
        clusterId: client.cluster.id,
        shardIds: client.cluster.shardList,
      },
      "Skipping background tasks on non-main cluster",
    );

    return;
  }

  logger.info(
    {
      clusterId: client.cluster.id,
      shardIds: client.cluster.shardList,
      isCluster0,
    },
    "Starting background tasks on cluster with shard 0",
  );

  for (const task of featureTasks) {
    const cron = new CronJob(task.cronTime, async () => {
      try {
        logger.info(
          {
            taskName: task.name,
            clusterId: client.cluster.id,
          },
          "Running background task",
        );

        // onTick will check deployment status before executing the task
        await task.onTick();
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            type: "task",
            name: task.name,
            clusterId: client.cluster.id,
          },
        });

        logger.error(
          {
            err,
            taskName: task.name,
            clusterId: client.cluster.id,
          },
          "Error running background task",
        );
      }
    });

    // Actually start the cron job
    cron.start();

    logger.info(
      {
        taskName: task.name,
        clusterId: client.cluster.id,
      },
      "Started background task",
    );
  }
}
