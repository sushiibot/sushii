export interface Target {
  repository: string;
  repositoryId: number;
  environment: string;
  environmentId: number | string;
  mode?: "approved" | "automatic";
  sourceEvents?: string[];
  workflow: string;
  branch: string;
  channelId: string;
  label: string;
  initialDeployedSha?: string;
  releaseTarget: string;
  statusActorId: number;
  hostWaitJob?: { name: string; step: string };
}
export interface Config {
  ownerDiscordId: string;
  clientId: string;
  clientSecret: string;
  appId: number;
  appPrivateKey: string;
  installationId: number;
  callbackUrl: string;
  botToken: string;
  relayToken: string;
  webhookSecret: string;
  encryptionKey: string;
  targets: Target[];
}
export type Phase =
  | "stale"
  | "pending"
  | "deciding"
  | "approved"
  | "rejected"
  | "deploying"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface Candidate {
  id: string;
  revision: number;
  createdAt: number;
  repository: string;
  repositoryId: number;
  environment: string;
  environmentId: number | string;
  runId: number;
  runAttempt: number;
  sha: string;
  previousSha?: string;
  label: string;
  channelId: string;
  runUrl: string;
  phase: Phase;
  messageId?: string;
  threadMessageId?: string;
  // The newer card that took over this release; a replaced card never changes again.
  replacedBy?: string;
  detail: string;
}
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expiresAt: number;
  refreshExpiresAt?: number;
}
export class ExpectedError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}

export type LinkedAccount = TokenSet & { githubUserId: number };

export const CARD_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DAILY_CHECK_HOUR = 9;
export const DAILY_CHECK_TIME_ZONE = "America/Los_Angeles";
// A card refreshed shortly before the daily check is recent enough to keep.
export const DAILY_REISSUE_AFTER_MS = 12 * 60 * 60 * 1000;
export type RefreshOutcome = "posted" | "current" | "waiting";
export function cardExpired(
  card: Pick<Candidate, "createdAt">,
  now = Date.now(),
): boolean {
  return now >= card.createdAt + CARD_LIFETIME_MS;
}
