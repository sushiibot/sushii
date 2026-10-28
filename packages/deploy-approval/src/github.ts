import { createSign } from "node:crypto";
import {
  ExpectedError,
  type Config,
  type Target,
  type TokenSet,
} from "./types";

export class GitHub {
  private installation?: { token: string; expires: number };
  constructor(
    private config: Config,
    private transport: typeof fetch = fetch,
  ) {}

  async request(
    path: string,
    token: string,
    method = "GET",
    body?: unknown,
  ): Promise<any> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("Invalid GitHub API path");
    const response = await this.transport("https://api.github.com" + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new ExpectedError("github_authorization_required", 403);
      if (response.status === 404)
        throw new ExpectedError("github_resource_unavailable", 404);
      throw new Error("GitHub API request failed: " + response.status);
    }
    return response.status === 204 ? null : response.json();
  }

  async appToken(): Promise<string> {
    if (this.installation && this.installation.expires > Date.now() + 60000)
      return this.installation.token;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 30, exp: now + 300, iss: this.config.appId }),
    ).toString("base64url");
    const unsigned = header + "." + payload;
    const jwt =
      unsigned +
      "." +
      createSign("RSA-SHA256")
        .update(unsigned)
        .sign(this.config.appPrivateKey)
        .toString("base64url");
    const result = await this.request(
      "/app/installations/" + this.config.installationId + "/access_tokens",
      jwt,
      "POST",
      {
        repository_ids: [
          ...new Set(this.config.targets.map((t) => t.repositoryId)),
        ],
        permissions: {
          actions: "read",
          deployments: "read",
          contents: "read",
          statuses: "read",
        },
      },
    );
    if (
      typeof result.token !== "string" ||
      !Number.isFinite(Date.parse(result.expires_at))
    )
      throw new Error("Invalid installation token response");
    this.installation = {
      token: result.token,
      expires: Date.parse(result.expires_at),
    };
    return result.token;
  }

  async oauth(parameters: Record<string, string>): Promise<TokenSet> {
    const response = await this.transport(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          ...parameters,
        }),
      },
    );
    if (!response.ok) throw new ExpectedError("github_link_failed", 403);
    const value = (await response.json()) as Record<string, unknown>;
    if (
      typeof value.access_token !== "string" ||
      typeof value.refresh_token !== "string" ||
      typeof value.expires_in !== "number" ||
      value.expires_in <= 0 ||
      typeof value.refresh_token_expires_in !== "number" ||
      value.refresh_token_expires_in <= 0
    )
      throw new ExpectedError("expiring_github_token_required", 403);
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expiresAt: Date.now() + value.expires_in * 1000,
      refreshExpiresAt: Date.now() + value.refresh_token_expires_in * 1000,
    };
  }

  async pending(target: Target, runId: number, token: string) {
    if (target.mode === "automatic" || typeof target.environmentId !== "number")
      throw new ExpectedError("release_not_approvable");
    const prefix = "/repos/" + target.repository;
    const run = await this.request(prefix + "/actions/runs/" + runId, token);
    if (
      run.id !== runId ||
      run.repository?.id !== target.repositoryId ||
      run.head_repository?.id !== target.repositoryId ||
      run.event !== "push" ||
      run.head_branch !== target.branch ||
      run.path !== target.workflow ||
      run.run_attempt !== 1 ||
      !/^[a-f0-9]{40}$/.test(run.head_sha) ||
      !["waiting", "in_progress", "queued", "pending"].includes(run.status)
    )
      throw new ExpectedError("release_no_longer_pending");
    const head = await this.request(
      prefix + "/commits/" + encodeURIComponent(target.branch),
      token,
    );
    if (head.sha !== run.head_sha)
      throw new ExpectedError("release_superseded");
    const pending = await this.request(
      prefix + "/actions/runs/" + runId + "/pending_deployments",
      token,
    );
    const gate = pending.find(
      (p: any) =>
        p.environment?.id === target.environmentId &&
        p.environment?.name === target.environment,
    );
    if (!gate) throw new ExpectedError("release_no_longer_pending");
    return { run, gate };
  }
}
