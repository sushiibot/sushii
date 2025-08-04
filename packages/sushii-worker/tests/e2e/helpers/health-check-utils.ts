import { sleep } from "bun";
import { Logger } from "pino";

export interface HealthCheckResponse {
  status: "healthy" | "unhealthy" | "unknown";
  timestamp: string;
  deployment?: string;
  uptime?: number;
}

export type MetricsResponse = Record<string, number>;

export class HealthCheckUtils {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Check health endpoint of a bot instance
   */
  async checkBotHealth(port: number): Promise<HealthCheckResponse> {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
        };
      }

      const data = await response.json() as Record<string, unknown>;

      if (!data || typeof data !== "object") {
        this.logger.error({ port, data }, "Invalid health response format");

        return {
          status: "unknown",
          timestamp: new Date().toISOString(),
        };
      }

      return {
        status: "healthy",
        timestamp: (data.timestamp as string) || new Date().toISOString(),
        deployment: data.deployment as string,
        uptime: data.uptime as number,
      };
    } catch (err) {
      this.logger.error({ err, port }, "Failed to check bot health");

      return {
        status: "unknown",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check health of both bot instances
   */
  async checkAllBotsHealth(): Promise<{
    blue: HealthCheckResponse;
    green: HealthCheckResponse;
  }> {
    const [blue, green] = await Promise.all([
      this.checkBotHealth(8081), // Blue bot port
      this.checkBotHealth(8082), // Green bot port
    ]);

    return { blue, green };
  }

  /**
   * Wait for bot to be healthy
   */
  async waitForBotHealthy(port: number, timeoutMs = 30000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const health = await this.checkBotHealth(port);

      if (health.status === "healthy") {
        this.logger.info({ port }, "Bot is healthy");
        return;
      }

      this.logger.debug(
        { port, status: health.status },
        "Waiting for bot to be healthy",
      );
      await sleep(2000);
    }

    throw new Error(
      `Bot on port ${port} did not become healthy within ${timeoutMs}ms`,
    );
  }

  /**
   * Wait for both bots to be healthy
   */
  async waitForAllBotsHealthy(timeoutMs = 60000): Promise<void> {
    await Promise.all([
      this.waitForBotHealthy(8081, timeoutMs), // Blue bot
      this.waitForBotHealthy(8082, timeoutMs), // Green bot
    ]);
  }

  /**
   * Get metrics from bot instance
   */
  async getBotMetrics(port: number): Promise<MetricsResponse> {
    try {
      const response = await fetch(`http://localhost:${port}/metrics`, {
        method: "GET",
        headers: {
          Accept: "text/plain",
        },
      });

      if (!response.ok) {
        throw new Error(`Metrics endpoint returned ${response.status}`);
      }

      const metricsText = await response.text();
      return this.parsePrometheusMetrics(metricsText);
    } catch (err) {
      this.logger.error({ err, port }, "Failed to get bot metrics");
      throw err;
    }
  }

  /**
   * Parse Prometheus metrics text format
   */
  private parsePrometheusMetrics(metricsText: string): MetricsResponse {
    const metrics: MetricsResponse = {};
    const lines = metricsText.split("\n");

    for (const line of lines) {
      if (line.startsWith("#") || line.trim() === "") {
        continue;
      }

      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) {
        continue;
      }

      const metricName = line.substring(0, spaceIndex);
      const metricValue = parseFloat(line.substring(spaceIndex + 1));

      if (!isNaN(metricValue)) {
        metrics[metricName] = metricValue;
      }
    }

    return metrics;
  }
}
