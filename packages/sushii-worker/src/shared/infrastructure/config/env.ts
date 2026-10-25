import pino from "pino";
import { z } from "zod";

const deploymentNameSchema = z.enum(["blue", "green"]);

const envSchema = z.object({
  // Name of the deployment of the current running process. This is used to
  // switch handling of events/interactions between multiple running processes.
  // Default is "blue"
  DEPLOYMENT_NAME: deploymentNameSchema,
  // Only owner can modify deployment
  OWNER_USER_ID: z.string().optional(),
  // Comma-separated list of channel IDs that should bypass deployment checks
  DEPLOYMENT_EXEMPT_CHANNEL_IDS: z.string().optional(),
  // Comma-separated list of guild IDs that should bypass lookup command restrictions
  LOOKUP_EXEMPT_GUILD_IDS: z.string().optional(),

  // System configuration
  ASSET_DIR: z.string().min(1).optional(),
  ASSET_PUBLIC_BASE_URL: z.url().optional(),
  ASSET_REVISION: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  LOG_LEVEL: z.string().optional().default("info"),

  // Core Discord configuration
  APPLICATION_ID: z.string(),
  SHARDS_PER_CLUSTER: z.coerce.number().optional(),

  // Metrics and health check configuration
  METRICS_PORT: z.string().optional().default("9090"),
  HEALTH_PORT: z.string().optional().default("8080"),
  PUBLIC_API_PORT: z.string().optional().default("8082"),

  // Example: 'https://discord.com/api'
  DISCORD_API_PROXY_URL: z.string().optional(),

  // Alerts
  NOTIFY_WEBHOOK_USERNAME: z.string().optional(),

  // Sentry
  SENTRY_ENVIRONMENT: z.string().optional(),

  // Tracing
  TRACING_EXPORTER_URL: z.string().optional(),
  TRACING_SAMPLE_PERCENTAGE: z
    .preprocess((val) => Number(val), z.number())
    .optional()
    .default(0.05), // 5%

  // Settings
  SKIP_COMMAND_REGISTRATION: z
    .preprocess((x) => x === "true", z.boolean())
    .optional()
    .default(false),

  // Build information
  GIT_HASH: z.string().optional(),
  BUILD_DATE: z.string().optional(),

  // Development / test options
  MANUAL_SHARD_COUNT: z.coerce.number().optional(),

  OPENROUTER_SCAM_CLASSIFY_MODEL: z
    .string()
    .optional()
    .default("stepfun/step-3.7-flash"),

  // Scam image dataset storage (Backblaze B2 / S3-compatible)
  // Uploads also need the SCAM_IMAGE_STORE_* secrets; absent = feature disabled
  SCAM_IMAGE_STORE_ENDPOINT: z.string().optional(),
  SCAM_IMAGE_STORE_BUCKET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Temporary logger since we need the config to setup the real one
  const logger = pino();

  logger.error(
    {
      error: z.prettifyError(parsed.error),
    },
    "❌ Invalid environment variables",
  );

  process.exit(1);
}

export type Env = z.infer<typeof envSchema>;
export const env = parsed.data;
