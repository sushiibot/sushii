import { beforeEach, describe, expect, test } from "bun:test";
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

function makeService(
  processName: "blue" | "green",
  activeDeployment: "blue" | "green" = "blue",
) {
  const repo = new MockDeploymentRepository();
  // Pre-set the active deployment without going through start()
  if (activeDeployment !== "blue") {
    repo.setActive(Deployment.create(activeDeployment));
  }
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
    const { service } = makeService("blue", "blue");
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
    const { service } = makeService("blue", "blue");
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
    const { service } = makeService("blue", "blue");
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
    const { service } = makeService("green", "blue");
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
  let readyManager: ReturnType<typeof makeManager>;

  beforeEach(() => {
    readyManager = makeManager([{ id: 0, ready: true, shardList: [0] }]);
  });

  test("returns 400 for invalid JSON body", async () => {
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toInclude("Invalid JSON");
  });

  test("returns 400 for missing target", async () => {
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toInclude("Invalid target");
  });

  test("returns 400 for invalid target value", async () => {
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "red" }),
    });

    expect(res.status).toBe(400);
  });

  test("returns 400 when target does not match this instance", async () => {
    // This is a "green" process but target says "blue"
    const { service } = makeService("green", "blue");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "blue" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toInclude("does not match this instance");
  });

  test("returns 503 when not all clusters have spawned yet", async () => {
    // 1 of 2 expected clusters has spawned and is ready — same bug as the status endpoint
    const notSpawnedManager = makeManager(
      [{ id: 0, ready: true, shardList: [0] }],
      2, // totalShards
      2, // totalClusters — cluster 1 hasn't spawned yet
    );
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(notSpawnedManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "blue" }),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toInclude("not ready");
  });

  test("returns 503 when clusters are not ready", async () => {
    const notReadyManager = makeManager([
      { id: 0, ready: false, shardList: [0] },
    ]);
    // blue process, green is active → blue is the inactive target
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(notReadyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "blue" }),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toInclude("not ready");
  });

  test("returns 409 when this deployment is already active", async () => {
    // blue process, blue is active → calling switch on an already-active instance
    const { service } = makeService("blue", "blue");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "blue" }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toInclude("already the active deployment");
  });

  test("returns 200 and correct fields on successful switch", async () => {
    // blue process, green is currently active → blue is the inactive target
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);
    const res = await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "blue" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.previous_deployment).toBe("green");
    expect(body.new_deployment).toBe("blue");
  });

  test("after switch, is_active reflects new state", async () => {
    const { service } = makeService("blue", "green");
    await service.start();

    const app = createMonitoringApp(readyManager, [], service);

    // Before switch: blue is inactive
    const before = await app.request("/deployment/status");
    expect(((await before.json()) as Record<string, unknown>).is_active).toBe(false);

    // Perform switch
    await app.request("/deployment/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "blue" }),
    });

    // After switch: blue is now active
    const after = await app.request("/deployment/status");
    expect(((await after.json()) as Record<string, unknown>).is_active).toBe(true);
  });
});
