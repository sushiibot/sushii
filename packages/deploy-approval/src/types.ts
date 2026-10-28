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
