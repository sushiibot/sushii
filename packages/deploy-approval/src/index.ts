import { RelayQueue } from "./relay";
import { readFileSync } from "node:fs";
import { backendHandler, relayHandler } from "./http";
import { ApprovalService } from "./service";
import { Store } from "./store";
import type { Config, Target } from "./types";

function required(name: string): string {
  const value = process.env[name + "_FILE"]
    ? readFileSync(process.env[name + "_FILE"]!, "utf8").trim()
    : process.env[name];
  if (!value) throw new Error("Missing configuration: " + name);
  return value;
}
function positive(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Invalid numeric configuration: " + name);
  return value;
}
process.umask(0o077);
const mode = required("APPROVAL_MODE");
const hostname = process.env.BIND_ADDRESS ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3080");
if (mode === "relay") {
  const queue = new RelayQueue(required("DATABASE_PATH"));
  const destination = new URL(
    "/internal/github",
    required("APPROVAL_BACKEND_URL"),
  );
  const token = required("APPROVAL_RELAY_TOKEN");
  const secret = required("GITHUB_WEBHOOK_SECRET");
  if (token.length < 32 || secret.length < 32)
    throw new Error("Relay secrets must be at least 32 characters");
  Bun.serve({
    hostname,
    port,
    fetch: relayHandler({ secret }, queue),
    maxRequestBodySize: 2 * 1024 * 1024,
  });
  setInterval(() => {
    void queue
      .drain(destination, token)
      .catch(() => console.error("Relay queue processing failed"));
  }, 2000).unref();
  void queue
    .drain(destination, token)
    .catch(() => console.error("Relay queue processing failed"));
} else if (mode === "backend") {
  const targets = JSON.parse(
    readFileSync(required("APPROVAL_TARGETS_FILE"), "utf8"),
  ) as Target[];
  if (
    !Array.isArray(targets) ||
    !targets.length ||
    targets.some(
      (t) =>
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t.repository) ||
        !Number.isSafeInteger(t.repositoryId) ||
        t.repositoryId <= 0 ||
        !Number.isSafeInteger(t.environmentId) ||
        t.environmentId <= 0 ||
        !/^[a-z0-9][a-z0-9-]*$/.test(t.releaseTarget) ||
        !Number.isSafeInteger(t.statusActorId) ||
        t.statusActorId <= 0 ||
        typeof t.environment !== "string" ||
        !t.environment ||
        !/^[0-9]{17,20}$/.test(t.channelId) ||
        !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(t.workflow) ||
        typeof t.branch !== "string" ||
        !t.branch ||
        typeof t.label !== "string" ||
        t.label.length > 100,
    )
  )
    throw new Error("Invalid approval target configuration");
  if (
    new Set(targets.map((t) => t.repositoryId + ":" + t.environmentId)).size !==
    targets.length
  )
    throw new Error("Duplicate approval target");
  const callbackUrl = required("GITHUB_CALLBACK_URL");
  const callback = new URL(callbackUrl);
  if (
    callback.protocol !== "https:" ||
    callback.pathname !== "/oauth/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error("Expected fixed HTTPS OAuth callback URL");
  const config: Config = {
    ownerDiscordId: required("OWNER_DISCORD_ID"),
    ownerGitHubId: positive("OWNER_GITHUB_ID"),
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
    appId: positive("GITHUB_APP_ID"),
    appPrivateKey: required("GITHUB_PRIVATE_KEY"),
    installationId: positive("GITHUB_INSTALLATION_ID"),
    callbackUrl,
    botToken: required("APPROVAL_BOT_TOKEN"),
    relayToken: required("APPROVAL_RELAY_TOKEN"),
    webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
    encryptionKey: required("TOKEN_ENCRYPTION_KEY"),
    targets,
  };
  if (
    !/^[0-9]{17,20}$/.test(config.ownerDiscordId) ||
    config.botToken.length < 32 ||
    config.relayToken.length < 32 ||
    config.webhookSecret.length < 32 ||
    config.botToken === config.relayToken
  )
    throw new Error("Invalid approval identity or shared secrets");
  const service = new ApprovalService(
    config,
    new Store(required("DATABASE_PATH")),
  );
  Bun.serve({
    hostname,
    port,
    fetch: backendHandler(service),
    maxRequestBodySize: 2 * 1024 * 1024,
    idleTimeout: 60,
  });
  // Retry persisted deliveries only. This is not a GitHub status polling loop.
  const timer = setInterval(() => {
    void service
      .processInbox()
      .catch(() => console.error("Approval inbox processing failed"));
  }, 2000);
  timer.unref();
  void service
    .processInbox()
    .catch(() => console.error("Approval inbox processing failed"));
} else throw new Error("APPROVAL_MODE must be relay or backend");
