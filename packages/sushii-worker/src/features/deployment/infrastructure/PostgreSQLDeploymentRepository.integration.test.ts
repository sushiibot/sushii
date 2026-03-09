import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import pino from "pino";

import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import { SimpleEventBus } from "@/shared/infrastructure/SimpleEventBus";

import { DeploymentChanged } from "../domain/events/DeploymentChanged";
import { PostgreSQLDeploymentRepository } from "./PostgreSQLDeploymentRepository";

const logger = pino({ level: "silent" });

describe("PostgreSQLDeploymentRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let repoA: PostgreSQLDeploymentRepository;
  let repoB: PostgreSQLDeploymentRepository;
  let eventBusA: SimpleEventBus;
  let eventBusB: SimpleEventBus;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    await testDb.initialize();
  });

  afterAll(async () => {
    await testDb.close();
  });

  afterEach(async () => {
    await repoA?.stop();
    await repoB?.stop();
  });

  function makeRepo(
    name: string,
    eventBus: SimpleEventBus,
  ): PostgreSQLDeploymentRepository {
    return new PostgreSQLDeploymentRepository(
      testDb.getConnectionString(),
      logger,
      eventBus,
      name,
    );
  }

  test("getActive returns blue as default when no row exists", async () => {
    eventBusA = new SimpleEventBus();
    repoA = makeRepo("test-repo-a", eventBusA);
    await repoA.start();

    const deployment = await repoA.getActive();
    expect(deployment.name).toBe("blue");
  });

  test("setActive persists deployment to database", async () => {
    eventBusA = new SimpleEventBus();
    eventBusB = new SimpleEventBus();
    repoA = makeRepo("test-repo-a", eventBusA);
    repoB = makeRepo("test-repo-b", eventBusB);
    await repoA.start();
    await repoB.start();

    const { Deployment } = await import("../domain/entities/Deployment");
    await repoA.setActive(Deployment.create("green"));

    // repoB reads from the same DB independently
    const deployment = await repoB.getActive();
    expect(deployment.name).toBe("green");
  });

  test("setActive sends NOTIFY that is received by second repository", async () => {
    eventBusA = new SimpleEventBus();
    eventBusB = new SimpleEventBus();
    repoA = makeRepo("test-repo-a", eventBusA);
    repoB = makeRepo("test-repo-b", eventBusB);
    await repoA.start();
    await repoB.start();

    // Collect events received by repoB's event bus
    const receivedEvents: DeploymentChanged[] = [];
    eventBusB.subscribe(DeploymentChanged, (event) => {
      receivedEvents.push(event);
    });

    const { Deployment } = await import("../domain/entities/Deployment");
    await repoA.setActive(Deployment.create("green"));

    // Wait for async NOTIFY to propagate
    await Bun.sleep(200);

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].newDeployment).toBe("green");
  });

  test("NOTIFY propagates back to the sender too", async () => {
    eventBusA = new SimpleEventBus();
    repoA = makeRepo("test-repo-a", eventBusA);
    await repoA.start();

    const receivedEvents: DeploymentChanged[] = [];
    eventBusA.subscribe(DeploymentChanged, (event) => {
      receivedEvents.push(event);
    });

    const { Deployment } = await import("../domain/entities/Deployment");
    await repoA.setActive(Deployment.create("green"));

    await Bun.sleep(200);

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].newDeployment).toBe("green");
  });

  test("setActive is idempotent — switching to same value still notifies", async () => {
    eventBusA = new SimpleEventBus();
    eventBusB = new SimpleEventBus();
    repoA = makeRepo("test-repo-a", eventBusA);
    repoB = makeRepo("test-repo-b", eventBusB);
    await repoA.start();
    await repoB.start();

    const receivedEvents: DeploymentChanged[] = [];
    eventBusB.subscribe(DeploymentChanged, (event) => {
      receivedEvents.push(event);
    });

    const { Deployment } = await import("../domain/entities/Deployment");
    await repoA.setActive(Deployment.create("blue"));
    await repoA.setActive(Deployment.create("blue"));

    await Bun.sleep(200);

    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents.every((e) => e.newDeployment === "blue")).toBe(true);
  });

  test("full switchover: blue→green propagates and blue sees itself as inactive", async () => {
    eventBusA = new SimpleEventBus();
    eventBusB = new SimpleEventBus();
    // repoA = "blue" process, repoB = "green" process
    repoA = makeRepo("blue-process", eventBusA);
    repoB = makeRepo("green-process", eventBusB);
    await repoA.start();
    await repoB.start();

    const { Deployment } = await import("../domain/entities/Deployment");
    const { DeploymentService } = await import(
      "../application/DeploymentService"
    );
    const { DeploymentConfig } = await import(
      "@/shared/infrastructure/config/config"
    );

    // Simulate blue being the initially active deployment
    await repoA.setActive(Deployment.create("blue"));
    await Bun.sleep(100);

    const blueService = new DeploymentService(
      repoA,
      logger,
      "blue",
      new DeploymentConfig("blue"),
    );
    const greenService = new DeploymentService(
      repoB,
      logger,
      "green",
      new DeploymentConfig("green"),
    );

    eventBusA.subscribe(DeploymentChanged, (e) =>
      blueService.handleDeploymentChanged(e),
    );
    eventBusB.subscribe(DeploymentChanged, (e) =>
      greenService.handleDeploymentChanged(e),
    );

    await blueService.start();
    await greenService.start();

    expect(blueService.isCurrentDeploymentActive()).toBe(true);
    expect(greenService.isCurrentDeploymentActive()).toBe(false);

    // Green promotes itself (the switchover call)
    await greenService.setActiveDeployment("green");
    await Bun.sleep(200);

    // Both services should now reflect green as active
    expect(blueService.isCurrentDeploymentActive()).toBe(false);
    expect(greenService.isCurrentDeploymentActive()).toBe(true);

    await blueService.stop();
    await greenService.stop();
  });
});
