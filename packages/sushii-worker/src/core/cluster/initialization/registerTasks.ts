import * as Sentry from "@sentry/bun";
import { CronJob } from "cron";
import type { Client } from "discord.js";

import logger from "@/shared/infrastructure/logger";
import type { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

function startTask(client: Client, task: AbstractBackgroundTask): void {
  const cron = new CronJob(task.cronTime, async () => {
    try {
      logger.info(
        {
          taskName: task.name,
          clusterId: client.cluster.id,
        },
        "Running background task",
      );

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

  cron.start();

  logger.info(
    {
      taskName: task.name,
      clusterId: client.cluster.id,
    },
    "Started background task",
  );

  if (task.runOnInit) {
    task.onTick().catch((err) => {
      Sentry.captureException(err, {
        tags: {
          type: "task",
          name: task.name,
          clusterId: client.cluster.id,
        },
      });
      logger.error(
        { err, taskName: task.name, clusterId: client.cluster.id },
        "runOnInit task failed",
      );
    });
  }
}

export function registerTasks(
  client: Client,
  featureTasks: AbstractBackgroundTask[],
): void {
  const isCluster0 = client.cluster.shardList.includes(0);

  for (const task of featureTasks) {
    if (task.shouldRunOnCluster) {
      if (!task.shouldRunOnCluster()) {
        logger.info(
          {
            taskName: task.name,
            clusterId: client.cluster.id,
          },
          "Skipping cluster-owned task — predicate returned false on this cluster",
        );
        continue;
      }
    } else if (!isCluster0) {
      logger.info(
        {
          clusterId: client.cluster.id,
          shardIds: client.cluster.shardList,
        },
        "Skipping background task on non-main cluster",
      );
      continue;
    }

    startTask(client, task);
  }
}
