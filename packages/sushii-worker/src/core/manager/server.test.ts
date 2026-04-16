import { describe, expect, test } from "bun:test";
import pino from "pino";

import { DeploymentConfig } from "@/shared/infrastructure/config/config";
import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { Deployment } from "@/features/deployment/domain/entities/Deployment";
import type { DeploymentRepository } from "@/features/deployment/domain/repositories/DeploymentRepository";

import { createMonitoringApp } from "./server";

const logger = pino({ level: "silent" });

// Minimal ClusterManager mock matching the properties server.ts accesses
function makeManager(
  clusters: { id: number; ready: boolean; shardList: number[] }[],
  totalShards = clusters.flatMap((c) => c.shardList).length,
  totalClusters = clusters.length,
) {
  return {
    clusters: {
      values: () => clusters.values(),
      size: clusters.length,
    },
    totalShards,
    totalClusters,
  } as never;
}

// Mock repository — in-memory, no DB
class MockDeploymentRepository implements DeploymentRepository {
  private active: Deployment = Deployment.create("blue");

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async start() {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async stop() {}
  async getActive() {
    return this.active;
  }
  async setActive(d: Deployment) {
    this.active = d;
  }
}

async function makeService(
  processName: "blue" | "green",
  activeDeployment: "blue" | "green" = "blue",
) {
  const repo = new MockDeploymentRepository();
  // Pre-set the active deployment without going through start()
  await repo.setActive(Deployment.create(activeDeployment));
  const service = new DeploymentService(
    repo,
    logger,
    processName,
    new DeploymentConfig(processName),
  );
  return { service, repo };
}

// ---------------------------------------------------------------------------
// /deployment/status
// ---------------------------------------------------------------------------

describe("GET /deployment/status", () => {
  test("returns correct shape when all clusters are ready", async () => {
    const manager = makeManager([
      { id: 0, ready: true, shardList: [0, 1] },
      { id: 1, ready: true, shardList: [2, 3] },
    ]);
    const { service } = await makeService("blue", "blue");
    await service.start();

    const app = createMonitoringApp(manager, [], service);
    const res = await app.request("/deployment/status");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.this_deployment).toBe("blue");
    expect(body.active_deployment).toBe("blue");
    expect(body.is_active).toBe(true);
    expect(body.ready_to_switch).toBe(true);
    expect(body.health).toBe("healthy");
    expect(body.total_shards).toBe(4);
    expect(body.clusters).toHaveLength(2);
  });

  test("ready_to_switch is false when not all clusters have spawned yet", async () => {
    // 2 of 3 expected clusters have spawned, both ready — the bug we saw in production
    const manager = makeManager(
      [
        { id: 0, ready: true, shardList: [0, 1, 2, 3] },
        { id: 1, ready: true, shardList: [4, 5, 6, 7] },
      ],
      11, // totalShards (auto-detected from Discord)
      3,  // totalClusters — cluster 2 hasn't spawned yet
    );
    const { service } = await makeService("blue", "blue");
    await service.start();

    const app = createMonitoringApp(manager, [], service);
    const res = await app.request("/deployment/status");
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.ready_to_switch).toBe(false);
    expect(body.health).toBe("unhealthy");
  });

  test("ready_to_switch is false when a cluster is not ready", async () => {
    const manager = makeManager([
      { id: 0, ready: true, shardList: [0] },
      { id: 1, ready: false, shardList: [1] },
    ]);
    const { service } = await makeService("blue", "blue");
    await service.start();

    const app = createMonitoringApp(manager, [], service);
    const res = await app.request("/deployment/status");
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.ready_to_switch).toBe(false);
    expect(body.health).toBe("unhealthy");
  });

  test("is_active is false for the inactive deployment", async () => {
    const manager = makeManager([{ id: 0, ready: true, shardList: [0] }]);
    // green process but blue is active in DB
    const { service } = await makeService("green", "blue");
    await service.start();

    const app = createMonitoringApp(manager, [], service);
    const res = await app.request("/deployment/status");
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.this_deployment).toBe("green");
    expect(body.active_deployment).toBe("blue");
    expect(body.is_active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /deployment/switch
// ---------------------------------------------------------------------------

describe("POST /deployment/switch", () => {
  const readyManager = makeManager([{ id: 0, ready: true, shardList: [0] }]);

  async function postSwitch(
    app: ReturnType<typeof createMonitoringApp>,
    target: string,
  ): Promise<Response> {
    return app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
  }

  async function makeApp(
    processName: "blue" | "green",
    activeDeployment: "blue" | "green" = "blue",
  ) {
    const { service } = await makeService(processName, activeDeployment);
    await service.start();
    return createMonitoringApp(readyManager, [], service);
  }

  test("returns 400 for invalid JSON body", async () => {
    const { service } = await makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error as string).toInclude("Invalid JSON");
  });

  test("returns 400 for missing target", async () => {
    const app = await makeApp("blue", "green");
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error as string).toInclude("Invalid target");
  });

  test("returns 400 for invalid target value", async () => {
    const app = await makeApp("blue", "green");
    const res = await postSwitch(app, "red");

    expect(res.status).toBe(400);
  });

  test("returns 200 with no_op: true when switching to already-active slot", async () => {
    // blue process, blue is active → switch to blue is a no-op
    const app = await makeApp("blue", "blue");
    const res = await postSwitch(app, "blue");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.no_op).toBe(true);
  });

  test("green instance can switch to blue and returns 200", async () => {
    // green process, green is active in DB → switch to blue changes active from green to blue
    const app = await makeApp("green", "green");
    const res = await postSwitch(app, "blue");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.previous_deployment).toBe("green");
    expect(body.new_deployment).toBe("blue");
  });

  test("returns 200 and correct fields on successful switch", async () => {
    // blue process, green is currently active → blue is the inactive target
    const app = await makeApp("blue", "green");
    const res = await postSwitch(app, "blue");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.previous_deployment).toBe("green");
    expect(body.new_deployment).toBe("blue");
  });

  test("returns 500 when setActiveDeployment throws", async () => {
    const { service, repo } = await makeService("blue", "green");
    // Make the repo throw on next setActive call
    repo.setActive = async () => {
      throw new Error("DB connection lost");
    };
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await postSwitch(app, "blue");

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error as string).toInclude("Failed to switch");
  });

  test("after switch, is_active reflects new state", async () => {
    const { service } = await makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);

    // Before switch: blue is inactive
    const before = await app.request("/deployment/status");
    expect(((await before.json()) as Record<string, unknown>).is_active).toBe(false);

    // Perform switch
    await postSwitch(app, "blue");

    // After switch: blue is now active
    const after = await app.request("/deployment/status");
    expect(((await after.json()) as Record<string, unknown>).is_active).toBe(true);
  });
});
