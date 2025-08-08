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

describe("Deployment Health and Metrics E2E Tests", () => {
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

  describe("Health check endpoints", () => {
    test("should return healthy status for both bots", async () => {
      const healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();

      expect(healthStatus.blue.status).toBe("healthy");
      expect(healthStatus.green.status).toBe("healthy");
      expect(healthStatus.blue.timestamp).toBeDefined();
      expect(healthStatus.green.timestamp).toBeDefined();
    });

    test("should include uptime information in health response", async () => {
      const healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();

      expect(healthStatus.blue.uptime).toBeDefined();
      expect(healthStatus.green.uptime).toBeDefined();
      expect(healthStatus.blue.uptime).toBeGreaterThan(0);
      expect(healthStatus.green.uptime).toBeGreaterThan(0);
    });
  });

  describe("Metrics endpoints", () => {
    test("should return metrics from both bots", async () => {
      const [blueMetrics, greenMetrics] = await Promise.all([
        testEnv.healthCheckUtils.getBotMetrics(9091), // Blue bot metrics port
        testEnv.healthCheckUtils.getBotMetrics(9092), // Green bot metrics port
      ]);

      expect(blueMetrics).toBeDefined();
      expect(greenMetrics).toBeDefined();
      expect(typeof blueMetrics).toBe("object");
      expect(typeof greenMetrics).toBe("object");
    });

    test("should include process metrics", async () => {
      const blueMetrics = await testEnv.healthCheckUtils.getBotMetrics(9091);

      // Check for common Node.js process metrics
      const metricNames = Object.keys(blueMetrics);

      // Should have some process-related metrics
      expect(metricNames.length).toBeGreaterThan(0);

      // Common metrics that should be present
      const expectedMetricPatterns = [/process_/, /nodejs_/, /http_/];

      const hasExpectedMetrics = expectedMetricPatterns.some((pattern) =>
        metricNames.some((name) => pattern.test(name)),
      );

      expect(hasExpectedMetrics).toBe(true);
    });

    test("should track metrics from both bots", async () => {
      const blueMetrics = await testEnv.healthCheckUtils.getBotMetrics(9091);
      const greenMetrics = await testEnv.healthCheckUtils.getBotMetrics(9092);

      // Both bots should have metrics
      expect(Object.keys(blueMetrics).length).toBeGreaterThan(0);
      expect(Object.keys(greenMetrics).length).toBeGreaterThan(0);

      // Metrics should be numeric values
      Object.values(blueMetrics).forEach((value) => {
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
      });
    });
  });

  describe("Bot lifecycle health", () => {
    test("should maintain health during database operations", async () => {
      // Initial health check
      let healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();
      expect(healthStatus.blue.status).toBe("healthy");
      expect(healthStatus.green.status).toBe("healthy");

      // Trigger database operation
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Health should still be good after database operation
      healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();
      expect(healthStatus.blue.status).toBe("healthy");
      expect(healthStatus.green.status).toBe("healthy");
    });

    test("should recover health after bot restart", async () => {
      // Initial health check
      let healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();
      expect(healthStatus.blue.status).toBe("healthy");

      // Restart blue bot
      await deploymentSetup.restartBot("blue");

      // Health should be restored
      healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();
      expect(healthStatus.blue.status).toBe("healthy");
    });

    test("should maintain health through rapid database changes", async () => {
      // Perform rapid database operations
      await deploymentSetup.triggerDeploymentSwitchover("blue");
      await deploymentSetup.triggerDeploymentSwitchover("green");
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Health should still be good
      const healthStatus = await testEnv.healthCheckUtils.checkAllBotsHealth();
      expect(healthStatus.blue.status).toBe("healthy");
      expect(healthStatus.green.status).toBe("healthy");
    });
  });

  describe("Metrics consistency", () => {
    test("should have metrics available from both bots", async () => {
      const [blueMetrics, greenMetrics] = await Promise.all([
        testEnv.healthCheckUtils.getBotMetrics(9091),
        testEnv.healthCheckUtils.getBotMetrics(9092),
      ]);

      // Both should have metrics
      expect(Object.keys(blueMetrics).length).toBeGreaterThan(0);
      expect(Object.keys(greenMetrics).length).toBeGreaterThan(0);

      // Both should have similar metric names (process metrics)
      const blueMetricNames = Object.keys(blueMetrics);
      const greenMetricNames = Object.keys(greenMetrics);

      // Should have some overlap in metric names
      const commonMetrics = blueMetricNames.filter((name) =>
        greenMetricNames.includes(name),
      );

      expect(commonMetrics.length).toBeGreaterThan(0);
    });

    test("should maintain metrics during database operations", async () => {
      // Get initial metrics
      const initialBlueMetrics =
        await testEnv.healthCheckUtils.getBotMetrics(9091);
      expect(Object.keys(initialBlueMetrics).length).toBeGreaterThan(0);

      // Perform database operation
      await deploymentSetup.triggerDeploymentSwitchover("blue");

      // Get metrics after operation
      const afterBlueMetrics =
        await testEnv.healthCheckUtils.getBotMetrics(9091);
      expect(Object.keys(afterBlueMetrics).length).toBeGreaterThan(0);

      // Should still have metrics available
      expect(Object.keys(afterBlueMetrics).length).toBeGreaterThanOrEqual(
        Object.keys(initialBlueMetrics).length,
      );
    });
  });

  describe("Performance monitoring", () => {
    test("should track uptime correctly", async () => {
      // Get initial uptime
      const initialHealth = await testEnv.healthCheckUtils.checkAllBotsHealth();
      const initialUptime = initialHealth.blue.uptime;

      expect(initialUptime).toBeDefined();
      expect(initialUptime).toBeGreaterThan(0);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get uptime again
      const laterHealth = await testEnv.healthCheckUtils.checkAllBotsHealth();
      const laterUptime = laterHealth.blue.uptime;

      expect(laterUptime).toBeDefined();
      expect(laterUptime).toBeGreaterThan(initialUptime ?? 0);
    });

    test("should reset uptime after bot restart", async () => {
      // Get initial uptime
      const initialHealth = await testEnv.healthCheckUtils.checkAllBotsHealth();
      const initialUptime = initialHealth.blue.uptime;

      expect(initialUptime).toBeDefined();
      expect(initialUptime).toBeGreaterThan(0);

      // Restart blue bot
      await deploymentSetup.restartBot("blue");

      // Get uptime after restart
      const afterRestartHealth =
        await testEnv.healthCheckUtils.checkAllBotsHealth();
      const afterRestartUptime = afterRestartHealth.blue.uptime;

      expect(afterRestartUptime).toBeDefined();
      expect(afterRestartUptime).toBeLessThan(
        initialUptime ?? Number.MAX_SAFE_INTEGER,
      );
    });
  });
});
