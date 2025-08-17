import { type Env, env } from "./env";

export class DatabaseConfig {
  constructor(readonly url: string) {}

  get host() {
    return new URL(this.url).hostname;
  }

  get port() {
    return new URL(this.url).port;
  }
}

export class DiscordConfig {
  constructor(
    readonly token: string,
    readonly applicationId: string,
    readonly proxyUrl?: string,
  ) {}

  get hasProxy() {
    return this.proxyUrl !== undefined;
  }
}

export class LoggingConfig {
  constructor(readonly level: string) {}

  get isDebug() {
    return this.level === "debug";
  }

  get isTrace() {
    return this.level === "trace";
  }
}

export class MetricsConfig {
  constructor(
    readonly port: number,
    readonly healthPort: number,
  ) {}
}

export class TracingConfig {
  constructor(
    readonly exporterUrl?: string,
    readonly samplePercentage: number = 0.05,
  ) {}

  get isEnabled() {
    return this.exporterUrl !== undefined;
  }
}

export class NotificationConfig {
  constructor(
    readonly webhookUsername?: string,
    readonly webhookUrl?: string,
    readonly errorWebhookUrl?: string,
    readonly activityWebhookUrl?: string,
  ) {}

  get hasWebhook() {
    return this.webhookUrl !== undefined;
  }

  get hasErrorWebhook() {
    return this.errorWebhookUrl !== undefined;
  }

  get hasActivityWebhook() {
    return this.activityWebhookUrl !== undefined;
  }
}

export class DeploymentConfig {
  constructor(
    readonly name: "blue" | "green",
    readonly ownerUserId?: string,
    readonly exemptChannelIds: Set<string> = new Set(),
    readonly e2eWebhookUrl?: string,
  ) {}

  get hasOwner() {
    return this.ownerUserId !== undefined;
  }

  get hasExemptChannels() {
    return this.exemptChannelIds.size > 0;
  }

  get e2eWebhookId(): string | undefined {
    if (!this.e2eWebhookUrl) {
      return undefined;
    }

    const match = this.e2eWebhookUrl.match(/\/webhooks\/(\d+)\//);
    return match?.[1];
  }
}

export class FeatureFlags {
  constructor(readonly skipCommandRegistration: boolean) {}
}

export class BuildConfig {
  constructor(
    readonly gitHash?: string,
    readonly buildDate?: Date,
  ) {}
}

export class Config {
  readonly database: DatabaseConfig;
  readonly discord: DiscordConfig;
  readonly logging: LoggingConfig;
  readonly metrics: MetricsConfig;
  readonly tracing: TracingConfig;
  readonly notifications: NotificationConfig;
  readonly deployment: DeploymentConfig;
  readonly features: FeatureFlags;
  readonly build: BuildConfig;
  readonly sentry: {
    dsn?: string;
    environment: string;
  };

  readonly manualShardCount?: number;
  readonly shardsPerCluster?: number;

  constructor(env: Env) {
    this.database = new DatabaseConfig(env.DATABASE_URL);
    this.discord = new DiscordConfig(
      env.DISCORD_TOKEN,
      env.APPLICATION_ID,
      env.DISCORD_API_PROXY_URL,
    );
    this.logging = new LoggingConfig(env.LOG_LEVEL);
    this.metrics = new MetricsConfig(
      parseInt(env.METRICS_PORT),
      parseInt(env.HEALTH_PORT),
    );
    this.tracing = new TracingConfig(
      env.TRACING_EXPORTER_URL,
      env.TRACING_SAMPLE_PERCENTAGE,
    );
    this.notifications = new NotificationConfig(
      env.NOTIFY_WEBHOOK_USERNAME,
      env.NOTIFY_WEBHOOK_URL,
      env.NOTIFY_WEBHOOK_ERR_URL,
      env.ACTIVITY_WEBHOOK_URL,
    );
    this.deployment = new DeploymentConfig(
      env.DEPLOYMENT_NAME,
      env.OWNER_USER_ID,
      env.DEPLOYMENT_EXEMPT_CHANNEL_IDS
        ? new Set(
            env.DEPLOYMENT_EXEMPT_CHANNEL_IDS.split(",")
              .map((id) => id.trim())
              .filter((id) => id.length > 0),
          )
        : new Set(),
      env.E2E_WEBHOOK_URL,
    );
    this.features = new FeatureFlags(env.SKIP_COMMAND_REGISTRATION);
    this.build = new BuildConfig(
      env.GIT_HASH,
      env.BUILD_DATE ? new Date(env.BUILD_DATE) : undefined,
    );
    this.sentry = {
      dsn: env.SENTRY_DSN,
      // Prioritize custom environment variable, then fall back toNODE_ENV
      environment:
        env.SENTRY_ENVIRONMENT || process.env.NODE_ENV === "production"
          ? "production"
          : "development",
    };

    this.manualShardCount = env.MANUAL_SHARD_COUNT;
    this.shardsPerCluster = env.SHARDS_PER_CLUSTER ?? 2;
  }
}

export const config = new Config(env);
