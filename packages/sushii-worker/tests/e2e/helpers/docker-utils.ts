import { execSync } from "child_process";
import path from "path";
import type { Logger } from "pino";

export interface DockerContainerInfo {
  name: string;
  status: "running" | "stopped" | "starting" | "unhealthy" | "healthy";
  ports: string[];
}

export class DockerUtils {
  private readonly logger: Logger;
  private readonly composeFile: string;

  constructor(logger: Logger, composeFile = "docker-compose.e2e.yml") {
    this.logger = logger;
    // Store compose file name - will be used from repo root
    this.composeFile = composeFile;
  }

  /**
   * Start the e2e test environment
   */
  async startTestEnvironment(): Promise<void> {
    this.logger.info("Starting e2e test environment...");

    try {
      // Build and start containers from repo root directory
      const repoRoot = path.resolve(process.cwd(), "../../");
      execSync(`docker compose -f ${this.composeFile} up -d --build`, {
        stdio: "inherit",
        cwd: repoRoot,
      });

      this.logger.info("Test environment started successfully");
    } catch (err) {
      this.logger.error({ err }, "Failed to start test environment");
      throw err;
    }
  }

  /**
   * Stop and clean up the test environment
   */
  async stopTestEnvironment(): Promise<void> {
    this.logger.info("Stopping e2e test environment...");

    try {
      // Stop and remove containers from repo root directory
      const repoRoot = path.resolve(process.cwd(), "../../");
      execSync(`docker compose -f ${this.composeFile} down -v`, {
        stdio: "inherit",
        cwd: repoRoot,
      });

      this.logger.info("Test environment stopped successfully");
    } catch (err) {
      this.logger.error({ err }, "Failed to stop test environment");
      throw err;
    }
  }

  /**
   * Get status of a specific container
   */
  getContainerStatus(containerName: string): DockerContainerInfo {
    try {
      const statusOutput = execSync(
        `docker inspect ${containerName} --format='{{.State.Status}}'`,
        { encoding: "utf8" },
      ).trim();

      const healthOutput = execSync(
        `docker inspect ${containerName} --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'`,
        { encoding: "utf8" },
      ).trim();

      const portsOutput = execSync(
        `docker inspect ${containerName} --format='{{range $p, $conf := .NetworkSettings.Ports}}{{$p}}->{{(index $conf 0).HostPort}} {{end}}'`,
        { encoding: "utf8" },
      ).trim();

      let status: DockerContainerInfo["status"];
      if (statusOutput === "running") {
        status =
          healthOutput === "healthy"
            ? "healthy"
            : healthOutput === "unhealthy"
              ? "unhealthy"
              : "running";
      } else {
        status = statusOutput as DockerContainerInfo["status"];
      }

      return {
        name: containerName,
        status,
        ports: portsOutput.split(" ").filter((p) => p.length > 0),
      };
    } catch (error) {
      this.logger.error(
        { error, containerName },
        "Failed to get container status",
      );
      return {
        name: containerName,
        status: "stopped",
        ports: [],
      };
    }
  }

  /**
   * Wait for a container to be healthy
   */
  async waitForContainerHealthy(
    containerName: string,
    timeoutMs = 60000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const info = this.getContainerStatus(containerName);

      if (info.status === "healthy") {
        this.logger.info({ containerName }, "Container is healthy");
        return;
      }

      if (info.status === "unhealthy") {
        throw new Error(`Container ${containerName} is unhealthy`);
      }

      this.logger.debug(
        { containerName, status: info.status },
        "Waiting for container to be healthy",
      );
      await this.sleep(2000);
    }

    throw new Error(
      `Container ${containerName} did not become healthy within ${timeoutMs}ms`,
    );
  }

  /**
   * Wait for multiple containers to be healthy
   */
  async waitForContainersHealthy(
    containerNames: string[],
    timeoutMs = 60000,
  ): Promise<void> {
    const promises = containerNames.map((name) =>
      this.waitForContainerHealthy(name, timeoutMs),
    );

    await Promise.all(promises);
  }

  /**
   * Get container logs
   */
  getContainerLogs(containerName: string, tailLines = 50): string {
    try {
      return execSync(`docker logs ${containerName} --tail ${tailLines}`, {
        encoding: "utf8",
      });
    } catch (error) {
      this.logger.error(
        { error, containerName },
        "Failed to get container logs",
      );
      return "";
    }
  }

  /**
   * Execute command in container
   */
  execInContainer(containerName: string, command: string): string {
    try {
      return execSync(`docker exec ${containerName} ${command}`, {
        encoding: "utf8",
      }).trim();
    } catch (error) {
      this.logger.error(
        { error, containerName, command },
        "Failed to execute command in container",
      );
      throw error;
    }
  }

  /**
   * Check if container is running
   */
  isContainerRunning(containerName: string): boolean {
    const info = this.getContainerStatus(containerName);
    return info.status === "running" || info.status === "healthy";
  }

  /**
   * Restart a specific container
   */
  async restartContainer(containerName: string): Promise<void> {
    this.logger.info({ containerName }, "Restarting container");

    try {
      execSync(`docker restart ${containerName}`, { stdio: "inherit" });
      await this.waitForContainerHealthy(containerName);
    } catch (error) {
      this.logger.error(
        { error, containerName },
        "Failed to restart container",
      );
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
