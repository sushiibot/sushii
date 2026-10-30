import { CronJob } from "cron";
import type { Client } from "discord.js";

import logger from "@/shared/infrastructure/logger";
import type { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

/**
 * Wraps a task's onTick so that runs never overlap. If a previous run (cron
 * tick or runOnInit) is still in progress, the new run is skipped. Errors are
 * captured and logged, never thrown.
 */
export function createNonOverlappingTaskRunner(
  task: Pick<AbstractBackgroundTask, "name" | "onTick">,
  clusterId: number,
): () => Promise<void> {
  let isRunning = false;

  return async () => {
    if (isRunning) {
      logger.debug(
        { taskName: task.name, clusterId },
        "Skipping background task run - previous run still in progress",
      );
      return;
    }

    isRunning = true;

    try {
      logger.info(
        { taskName: task.name, clusterId },
        "Running background task",
      );

      await task.onTick();
    } catch (err) {
      logger.error(
        { err, taskName: task.name, clusterId },
        "Error running background task",
      );
    } finally {
      isRunning = false;
    }
  };
}

function startTask(client: Client, task: AbstractBackgroundTask): void {
  const runTask = createNonOverlappingTaskRunner(task, client.cluster.id);

  // Overlap protection lives in runTask (shared with runOnInit below) rather
  // than cron's waitForCompletion, which skips ticks silently and wouldn't
  // cover the runOnInit run.
  const cron = new CronJob(task.cronTime, runTask);

  cron.start();

  logger.info(
    {
      taskName: task.name,
      clusterId: client.cluster.id,
    },
    "Started background task",
  );

  if (task.runOnInit) {
    void runTask();
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
