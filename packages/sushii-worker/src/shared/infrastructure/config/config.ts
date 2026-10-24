import { type Env, env } from "./env";
import { secrets, webhookIdFromUrl } from "./secrets";

export class DiscordConfig {
  constructor(
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
    readonly publicApiPort: number,
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
  constructor(readonly webhookUsername?: string) {}
}

export class DeploymentConfig {
  constructor(
    readonly name: "blue" | "green",
    readonly ownerUserId?: string,
    readonly exemptChannelIds: Set<string> = new Set(),
    readonly lookupExemptGuildIds: Set<string> = new Set(),
    readonly e2eWebhookId?: string,
  ) {}

  get hasOwner() {
    return this.ownerUserId !== undefined;
  }

  get hasExemptChannels() {
    return this.exemptChannelIds.size > 0;
  }

  get hasLookupExemptGuilds() {
    return this.lookupExemptGuildIds.size > 0;
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
  readonly discord: DiscordConfig;
  readonly logging: LoggingConfig;
  readonly metrics: MetricsConfig;
  readonly tracing: TracingConfig;
  readonly notifications: NotificationConfig;
  readonly deployment: DeploymentConfig;
  readonly features: FeatureFlags;
  readonly build: BuildConfig;
  readonly sentry: {
    environment: string;
  };
  readonly openRouterScamClassifyModel: string;
  readonly scamImageStoreEndpoint?: string;
  readonly scamImageStoreBucket?: string;

  readonly manualShardCount?: number;
  readonly shardsPerCluster?: number;

  constructor(env: Env, e2eWebhookId?: string) {
    this.discord = new DiscordConfig(
      env.APPLICATION_ID,
      env.DISCORD_API_PROXY_URL,
    );
    this.logging = new LoggingConfig(env.LOG_LEVEL);
    this.metrics = new MetricsConfig(
      parseInt(env.METRICS_PORT),
      parseInt(env.HEALTH_PORT),
      parseInt(env.PUBLIC_API_PORT),
    );
    this.tracing = new TracingConfig(
      env.TRACING_EXPORTER_URL,
      env.TRACING_SAMPLE_PERCENTAGE,
    );
    this.notifications = new NotificationConfig(env.NOTIFY_WEBHOOK_USERNAME);
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
      env.LOOKUP_EXEMPT_GUILD_IDS
        ? new Set(
            env.LOOKUP_EXEMPT_GUILD_IDS.split(",")
              .map((id) => id.trim())
              .filter((id) => id.length > 0),
          )
        : new Set(),
      e2eWebhookId,
    );
    this.features = new FeatureFlags(env.SKIP_COMMAND_REGISTRATION);
    this.build = new BuildConfig(
      env.GIT_HASH,
      env.BUILD_DATE ? new Date(env.BUILD_DATE) : undefined,
    );
    this.sentry = {
      // Prioritize custom environment variable, then fall back to NODE_ENV
      environment:
        env.SENTRY_ENVIRONMENT ??
        (process.env.NODE_ENV === "production" ? "production" : "development"),
    };

    this.openRouterScamClassifyModel = env.OPENROUTER_SCAM_CLASSIFY_MODEL;
    this.scamImageStoreEndpoint = env.SCAM_IMAGE_STORE_ENDPOINT;
    this.scamImageStoreBucket = env.SCAM_IMAGE_STORE_BUCKET;

    this.manualShardCount = env.MANUAL_SHARD_COUNT;
    this.shardsPerCluster = env.SHARDS_PER_CLUSTER ?? 2;
  }
}

export const config = new Config(
  env,
  webhookIdFromUrl(secrets.E2E_WEBHOOK_URL),
);
