import { beforeEach, describe, expect, test } from "bun:test";
import pino from "pino";

import { DeploymentConfig } from "@/shared/infrastructure/config/config";

import { Deployment } from "../domain/entities/Deployment";
import { DeploymentChanged } from "../domain/events/DeploymentChanged";
import type { DeploymentRepository } from "../domain/repositories/DeploymentRepository";
import { DeploymentService } from "./DeploymentService";

// Mock repository for testing
class MockDeploymentRepository implements DeploymentRepository {
  private activeDeployment: Deployment = Deployment.create("blue");
  private shouldThrowOnStart = false;
  private shouldThrowOnSetActive = false;

  async getActive(): Promise<Deployment> {
    return this.activeDeployment;
  }

  async setActive(deployment: Deployment): Promise<void> {
    if (this.shouldThrowOnSetActive) {
      throw new Error("Failed to set active deployment");
    }
    this.activeDeployment = deployment;
  }

  async start(): Promise<void> {
    if (this.shouldThrowOnStart) {
      throw new Error("Failed to start repository");
    }
  }

  async stop(): Promise<void> {
    // No-op for mock
  }

  // Test helpers
  setActiveDeployment(deployment: Deployment): void {
    this.activeDeployment = deployment;
  }

  setShouldThrowOnStart(shouldThrow: boolean): void {
    this.shouldThrowOnStart = shouldThrow;
  }

  setShouldThrowOnSetActive(shouldThrow: boolean): void {
    this.shouldThrowOnSetActive = shouldThrow;
  }
}

// Silent logger for tests
const testLogger = pino({ level: "silent" });

describe("DeploymentService", () => {
  let deploymentService: DeploymentService;
  let mockRepository: MockDeploymentRepository;
  let mockDeploymentConfig: DeploymentConfig;

  beforeEach(() => {
    mockRepository = new MockDeploymentRepository();
    mockDeploymentConfig = new DeploymentConfig("blue");
    deploymentService = new DeploymentService(
      mockRepository,
      testLogger,
      "blue",
      mockDeploymentConfig,
    );
  });

  describe("lifecycle", () => {
    test("should start and initialize current deployment", async () => {
      const greenDeployment = Deployment.create("green");
      mockRepository.setActiveDeployment(greenDeployment);

      await deploymentService.start();

      expect(deploymentService.getCurrentDeployment()).toBe("green");
    });

    test("should handle start errors", async () => {
      mockRepository.setShouldThrowOnStart(true);

      await expect(deploymentService.start()).rejects.toThrow();
    });

    test("should stop gracefully", async () => {
      await deploymentService.start();

      // Should not throw when stopping
      await expect(async () => {
        await deploymentService.stop();
      }).not.toThrow();
    });
  });

  describe("deployment state", () => {
    test("should return current deployment when initialized", async () => {
      const greenDeployment = Deployment.create("green");
      mockRepository.setActiveDeployment(greenDeployment);

      await deploymentService.start();

      expect(deploymentService.getCurrentDeployment()).toBe("green");
    });

    test("should return default when not initialized", () => {
      expect(deploymentService.getCurrentDeployment()).toBe("blue");
    });

    test("should correctly identify if current deployment is active", async () => {
      const blueDeployment = Deployment.create("blue");
      mockRepository.setActiveDeployment(blueDeployment);

      await deploymentService.start();

      expect(deploymentService.isCurrentDeploymentActive()).toBe(true);
    });

    test("should correctly identify when deployment is not active", async () => {
      const greenDeployment = Deployment.create("green");
      mockRepository.setActiveDeployment(greenDeployment);

      await deploymentService.start();

      expect(deploymentService.isCurrentDeploymentActive()).toBe(false);
    });
  });

  describe("deployment setting", () => {
    test("should set deployment to specific target", async () => {
      const blueDeployment = Deployment.create("blue");
      mockRepository.setActiveDeployment(blueDeployment);

      await deploymentService.start();
      const result = await deploymentService.setActiveDeployment("green");

      expect(result.changed).toBe(true);
      expect(result.deployment).toBe("green");
      expect(deploymentService.getCurrentDeployment()).toBe("green");
    });

    test("should return unchanged when setting to same deployment", async () => {
      const blueDeployment = Deployment.create("blue");
      mockRepository.setActiveDeployment(blueDeployment);

      await deploymentService.start();
      const result = await deploymentService.setActiveDeployment("blue");

      expect(result.changed).toBe(false);
      expect(result.deployment).toBe("blue");
      expect(deploymentService.getCurrentDeployment()).toBe("blue");
    });

    test("should throw when not initialized", async () => {
      await expect(
        deploymentService.setActiveDeployment("blue"),
      ).rejects.toThrow("Deployment service not initialized");
    });

    test("should handle repository errors during set", async () => {
      await deploymentService.start();
      mockRepository.setShouldThrowOnSetActive(true);

      await expect(
        deploymentService.setActiveDeployment("green"),
      ).rejects.toThrow();
    });
  });

  describe("deployment change handling", () => {
    test("should update deployment state from external changes", async () => {
      const blueDeployment = Deployment.create("blue");
      mockRepository.setActiveDeployment(blueDeployment);

      await deploymentService.start();

      const event = new DeploymentChanged("blue", "green");
      deploymentService.handleDeploymentChanged(event);

      expect(deploymentService.getCurrentDeployment()).toBe("green");
    });

    test("should handle changes when not initialized", () => {
      const event = new DeploymentChanged("blue", "green");

      expect(() =>
        deploymentService.handleDeploymentChanged(event),
      ).not.toThrow();

      expect(deploymentService.getCurrentDeployment()).toBe("green");
    });
  });

  describe("process variations", () => {
    test("should work with green process", async () => {
      const greenService = new DeploymentService(
        mockRepository,
        testLogger,
        "green",
        mockDeploymentConfig,
      );

      const greenDeployment = Deployment.create("green");
      mockRepository.setActiveDeployment(greenDeployment);

      await greenService.start();

      expect(greenService.isCurrentDeploymentActive()).toBe(true);
    });
  });

  describe("channel exemptions", () => {
    test("should return true when channel is exempt", async () => {
      const exemptChannels = new Set(["12345", "67890"]);
      const configWithExemptions = new DeploymentConfig(
        "blue",
        undefined,
        exemptChannels,
      );
      const serviceWithExemptions = new DeploymentService(
        mockRepository,
        testLogger,
        "blue",
        configWithExemptions,
      );

      await serviceWithExemptions.start();

      expect(
        serviceWithExemptions.isChannelExemptFromDeploymentCheck("12345"),
      ).toBe(true);
      expect(
        serviceWithExemptions.isChannelExemptFromDeploymentCheck("67890"),
      ).toBe(true);
      expect(
        serviceWithExemptions.isChannelExemptFromDeploymentCheck("99999"),
      ).toBe(false);
    });

    test("should return false when no exempt channels configured", async () => {
      await deploymentService.start();

      expect(
        deploymentService.isChannelExemptFromDeploymentCheck("12345"),
      ).toBe(false);
    });

    test("should return false when channel ID is undefined", async () => {
      const exemptChannels = new Set(["12345"]);
      const configWithExemptions = new DeploymentConfig(
        "blue",
        undefined,
        exemptChannels,
      );
      const serviceWithExemptions = new DeploymentService(
        mockRepository,
        testLogger,
        "blue",
        configWithExemptions,
      );

      await serviceWithExemptions.start();

      expect(
        serviceWithExemptions.isChannelExemptFromDeploymentCheck(undefined),
      ).toBe(false);
    });

    test("should allow processing when deployment is inactive but channel is exempt", async () => {
      const exemptChannels = new Set(["12345"]);
      const configWithExemptions = new DeploymentConfig(
        "blue",
        undefined,
        exemptChannels,
      );
      const serviceWithExemptions = new DeploymentService(
        mockRepository,
        testLogger,
        "blue",
        configWithExemptions,
      );

      // Set active deployment to green (making blue inactive)
      const greenDeployment = Deployment.create("green");
      mockRepository.setActiveDeployment(greenDeployment);

      await serviceWithExemptions.start();

      // Should be false without exempt channel
      expect(serviceWithExemptions.isCurrentDeploymentActive()).toBe(false);

      // Should be true with exempt channel
      expect(serviceWithExemptions.isCurrentDeploymentActive("12345")).toBe(
        true,
      );

      // Should be false with non-exempt channel
      expect(serviceWithExemptions.isCurrentDeploymentActive("99999")).toBe(
        false,
      );
    });

    test("should follow normal deployment logic when channel is not exempt", async () => {
      const exemptChannels = new Set(["12345"]);
      const configWithExemptions = new DeploymentConfig(
        "blue",
        undefined,
        exemptChannels,
      );
      const serviceWithExemptions = new DeploymentService(
        mockRepository,
        testLogger,
        "blue",
        configWithExemptions,
      );

      // Set active deployment to blue (making blue active)
      const blueDeployment = Deployment.create("blue");
      mockRepository.setActiveDeployment(blueDeployment);

      await serviceWithExemptions.start();

      // Should be true for active deployment, regardless of channel
      expect(serviceWithExemptions.isCurrentDeploymentActive("99999")).toBe(
        true,
      );
      expect(serviceWithExemptions.isCurrentDeploymentActive("12345")).toBe(
        true,
      );
    });
  });
});
