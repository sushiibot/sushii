import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import type {
  E2ETestEnvironment} from "./helpers/deployment-setup";
import {
  DeploymentSetup
} from "./helpers/deployment-setup";

describe("Deployment Switchover E2E Tests", () => {
  let testEnv: E2ETestEnvironment;
  let deploymentSetup: DeploymentSetup;

  beforeAll(async () => {
    deploymentSetup = new DeploymentSetup();
    testEnv = await deploymentSetup.setupTestEnvironment();
  });

  afterAll(async () => {
    await deploymentSetup.cleanupTestEnvironment();
  });

  beforeEach(async () => {
    // Reset deployment state before each test
    await deploymentSetup.initializeDeploymentState("blue");
  });

  describe("Initial deployment state", () => {
    test("should have both bots running after startup", async () => {
      const botsRunning = await deploymentSetup.areBotsRunning();

      expect(botsRunning.blue).toBe(true);
      expect(botsRunning.green).toBe(true);
    });

    test("should have both bots healthy", async () => {
      const healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();

      expect(healthStatus.blue.status).toBe("healthy");
      expect(healthStatus.green.status).toBe("healthy");
    });

    test("should have no active deployment initially", async () => {
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();

      expect(deploymentState.database).toBeNull();
      // Bots might have default deployment state, but database should be clean
    });
  });

  describe("Deployment switchover to blue", () => {
    test("should successfully switch to blue deployment", async () => {
      // Trigger switchover to blue
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Verify database reflects the change
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();

      expect(deploymentState.database).toBe("blue");
    });

    test("should persist blue deployment in database", async () => {
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Verify database state
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();
      expect(deploymentState.database).toBe("blue");
    });
  });

  describe("Deployment switchover to green", () => {
    test("should successfully switch to green deployment", async () => {
      // Trigger switchover to green
      await deploymentSetup.triggerDeploymentSwitchover("green");

      // Verify database reflects the change
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();

      expect(deploymentState.database).toBe("green");
    });

    test("should persist green deployment in database", async () => {
      await deploymentSetup.triggerDeploymentSwitchover("green");

      // Verify database state
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();
      expect(deploymentState.database).toBe("green");
    });
  });

  describe("Blue to green switchover", () => {
    test("should switch from blue to green", async () => {
      // First set to blue
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Then switch to green
      await deploymentSetup.triggerDeploymentSwitchover("green");

      // Verify the change
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();

      expect(deploymentState.database).toBe("green");
    });
  });

  describe("Green to blue switchover", () => {
    test("should switch from green to blue", async () => {
      // First set to green
      await deploymentSetup.triggerDeploymentSwitchover("green");

      // Then switch to blue
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Verify the change
      const deploymentState = await deploymentSetup.getCurrentDeploymentState();

      expect(deploymentState.database).toBe("blue");
    });
  });
});
