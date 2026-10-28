import { createHash } from "node:crypto";
import { GitHub } from "./github";
import { digest, randomToken, TokenCipher } from "./security";
import { Store } from "./store";
import {
  ExpectedError,
  type Candidate,
  type Config,
  type Target,
  type TokenSet,
} from "./types";

export class ApprovalService {
  readonly cipher: TokenCipher;
  private processing = false;
  private tokenRefresh?: Promise<string>;
  readonly listeners = new Set<() => void>();
  constructor(
    readonly config: Config,
    readonly store: Store,
    readonly github = new GitHub(config),
  ) {
    this.cipher = new TokenCipher(config.encryptionKey);
    for (const card of store.cards().filter((c) => c.phase === "deciding")) {
      store.update(card, {
        detail:
          "Approval interrupted by restart. Check GitHub before taking further action.",
      });
    }
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
  owner(actor: unknown) {
    if (actor !== this.config.ownerDiscordId)
      throw new ExpectedError("not_authorized", 403);
  }
  target(card: Pick<Candidate, "repositoryId" | "environmentId">): Target {
    const target = this.config.targets.find(
      (t) =>
        t.repositoryId === card.repositoryId &&
        t.environmentId === card.environmentId,
    );
    if (!target) throw new ExpectedError("target_not_allowed", 403);
    return target;
  }
  async userToken(): Promise<string> {
    if (this.tokenRefresh) return this.tokenRefresh;
    this.tokenRefresh = this.loadUserToken();
    try {
      return await this.tokenRefresh;
    } finally {
      this.tokenRefresh = undefined;
    }
  }
  private async loadUserToken(): Promise<string> {
    const id = this.config.ownerDiscordId;
    const stored = this.store.secret(id);
    if (!stored) throw new ExpectedError("github_link_required", 403);
    let tokens = this.cipher.decrypt<TokenSet>(stored, id);
    if (tokens.expiresAt < Date.now() + 60000) {
      if (
        !tokens.refresh_token ||
        !tokens.refreshExpiresAt ||
        tokens.refreshExpiresAt <= Date.now()
      )
        throw new ExpectedError("github_link_required", 403);
      tokens = await this.github.oauth({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      });
      if (this.store.secret(id) !== stored)
        throw new ExpectedError("github_link_required", 403);
      this.store.putSecret(id, this.cipher.encrypt(tokens, id));
    }
    const user = await this.github.request("/user", tokens.access_token);
    if (user.id !== this.config.ownerGitHubId)
      throw new ExpectedError("github_identity_mismatch", 403);
    return tokens.access_token;
  }

  link(actor: unknown) {
    this.owner(actor);
    const ticket = randomToken();
    this.store.db.query("DELETE FROM oauth WHERE expires<?").run(Date.now());
    this.store.db
      .query("INSERT INTO oauth VALUES(?,?,?)")
      .run(
        digest(ticket),
        this.cipher.encrypt({ kind: "ticket", actor }, digest(ticket)),
        Date.now() + 300000,
      );
    const url = new URL("/oauth/start", this.config.callbackUrl);
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }
  private consumeState(key: string): any {
    const hashed = digest(key);
    const row = this.store.db
      .query("DELETE FROM oauth WHERE state=? AND expires>? RETURNING value")
      .get(hashed, Date.now()) as { value: string } | null;
    if (!row) throw new ExpectedError("link_expired", 400);
    return this.cipher.decrypt(row.value, hashed);
  }
  start(ticket: string) {
    const data = this.consumeState(ticket);
    if (data.kind !== "ticket") throw new ExpectedError("invalid_link", 400);
    this.owner(data.actor);
    const state = randomToken(),
      verifier = randomToken(),
      browser = randomToken();
    this.store.db.query("INSERT INTO oauth VALUES(?,?,?)").run(
      digest(state),
      this.cipher.encrypt(
        {
          kind: "callback",
          actor: data.actor,
          verifier,
          browser: digest(browser),
        },
        digest(state),
      ),
      Date.now() + 300000,
    );
    const url = new URL("https://github.com/login/oauth/authorize");
    for (const [key, value] of Object.entries({
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      state,
      scope: "offline_access",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      allow_signup: "false",
    }))
      url.searchParams.set(key, value);
    return { url: url.toString(), browser };
  }
  async callback(state: string, code: string, browser: string) {
    const data = this.consumeState(state);
    if (
      data.kind !== "callback" ||
      !browser ||
      data.browser !== digest(browser)
    )
      throw new ExpectedError("invalid_oauth_state", 400);
    this.owner(data.actor);
    const tokens = await this.github.oauth({
      code,
      redirect_uri: this.config.callbackUrl,
      code_verifier: data.verifier,
    });
    const user = await this.github.request("/user", tokens.access_token);
    if (user.id !== this.config.ownerGitHubId)
      throw new ExpectedError("github_identity_mismatch", 403);
    this.store.putSecret(data.actor, this.cipher.encrypt(tokens, data.actor));
  }

  async review(actor: unknown, id: string, revision: number, decision: string) {
    this.owner(actor);
    if (!["approved", "rejected"].includes(decision))
      throw new ExpectedError("invalid_decision", 400);
    const card = this.store.card(id);
    if (!card || card.phase !== "pending" || card.revision !== revision)
      throw new ExpectedError("release_changed");
    const token = await this.userToken();
    const { run, gate } = await this.github.pending(
      this.target(card),
      card.runId,
      token,
    );
    if (
      run.head_sha !== card.sha ||
      run.run_attempt !== card.runAttempt ||
      gate.current_user_can_approve !== true
    )
      throw new ExpectedError("release_not_approvable");
    // A webhook may replace the candidate while the API request is in flight.
    if (this.store.card(id)?.revision !== revision)
      throw new ExpectedError("release_changed");
    const confirmation = randomToken();
    this.store.db
      .query("DELETE FROM confirmations WHERE expires<?")
      .run(Date.now());
    this.store.db
      .query("INSERT INTO confirmations VALUES(?,?,?,?,?,?)")
      .run(
        digest(confirmation),
        id,
        revision,
        actor as string,
        decision,
        Date.now() + 120000,
      );
    return { confirmation, card };
  }

  async decide(actor: unknown, confirmation: string) {
    this.owner(actor);
    const claim = this.store.db.transaction(() => {
      const entry = this.store.db
        .query(
          "DELETE FROM confirmations WHERE id=? AND actor=? AND expires>? RETURNING *",
        )
        .get(digest(confirmation), actor as string, Date.now()) as {
        card: string;
        revision: number;
        decision: string;
      } | null;
      if (!entry) throw new ExpectedError("confirmation_expired");
      const card = this.store.card(entry.card);
      if (!card || card.revision !== entry.revision || card.phase !== "pending")
        throw new ExpectedError("release_changed");
      return {
        card: this.store.update(card, {
          phase: "deciding",
          detail: "Verifying approval",
        }),
        decision: entry.decision,
      };
    })();
    this.notify();
    let submitted = false;
    try {
      const token = await this.userToken();
      const { run, gate } = await this.github.pending(
        this.target(claim.card),
        claim.card.runId,
        token,
      );
      if (
        run.head_sha !== claim.card.sha ||
        run.run_attempt !== claim.card.runAttempt ||
        gate.current_user_can_approve !== true
      )
        throw new ExpectedError("release_not_approvable");
      const latest = this.store.card(claim.card.id);
      if (
        !latest ||
        latest.phase !== "deciding" ||
        latest.revision !== claim.card.revision ||
        this.store
          .cards()
          .some(
            (c) =>
              c.repositoryId === claim.card.repositoryId &&
              c.environmentId === claim.card.environmentId &&
              c.runId > claim.card.runId,
          )
      )
        throw new ExpectedError("release_changed");
      submitted = true;
      await this.github.request(
        "/repos/" +
          claim.card.repository +
          "/actions/runs/" +
          claim.card.runId +
          "/pending_deployments",
        token,
        "POST",
        {
          environment_ids: [claim.card.environmentId],
          state: claim.decision,
          comment:
            "Requested through Discord by user " +
            actor +
            "; commit " +
            claim.card.sha,
        },
      );
      const current = this.store.card(claim.card.id)!;
      if (current.phase === "deciding")
        this.store.update(current, {
          phase: claim.decision as "approved" | "rejected",
          detail:
            claim.decision === "approved"
              ? "Approved; waiting for deployment"
              : "Release rejected",
        });
      this.notify();
    } catch (err) {
      const current = this.store.card(claim.card.id)!;
      if (current.phase === "deciding")
        this.store.update(
          current,
          submitted
            ? {
                detail:
                  "Approval response uncertain. Check GitHub before taking further action.",
              }
            : {
                phase: this.store
                  .cards()
                  .some(
                    (c) =>
                      c.id !== current.id &&
                      c.repositoryId === current.repositoryId &&
                      c.environmentId === current.environmentId &&
                      c.runId > current.runId,
                  )
                  ? "cancelled"
                  : "pending",
                detail:
                  "Approval was not submitted. Review the latest release.",
              },
        );
      this.notify();
      if (submitted) throw new ExpectedError("approval_result_uncertain", 502);
      throw err;
    }
  }

  enqueue(delivery: string, event: string, payload: string) {
    this.store.db
      .query("INSERT OR IGNORE INTO inbox(id,event,payload) VALUES(?,?,?)")
      .run(delivery, event, payload);
  }

  async processInbox() {
    if (this.processing) return;
    this.processing = true;
    try {
      const rows = this.store.db
        .query(
          "SELECT id,event,payload,attempts FROM inbox WHERE done=0 AND due<=?  ORDER BY rowid LIMIT 20",
        )
        .all(Date.now()) as {
        id: string;
        event: string;
        payload: string;
        attempts: number;
      }[];
      for (const row of rows) {
        try {
          await this.event(row.event, JSON.parse(row.payload));
          this.store.db
            .query("UPDATE inbox SET done=1,payload='{}' WHERE id=?")
            .run(row.id);
        } catch {
          // Retain the delivery for retries with capped backoff, without logging OAuth/API payloads.
          this.store.db
            .query("UPDATE inbox SET attempts=attempts+1,due=? WHERE id=?")
            .run(
              Date.now() +
                Math.min(300000, 2000 * 2 ** Math.min(row.attempts, 8)),
              row.id,
            );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async event(event: string, payload: any) {
    if (
      event === "github_app_authorization" &&
      payload.action === "revoked" &&
      payload.sender?.id === this.config.ownerGitHubId
    ) {
      this.store.db
        .query("DELETE FROM secrets WHERE id=?")
        .run(this.config.ownerDiscordId);
      return;
    }
    if (payload.installation?.id !== this.config.installationId) return;
    const targets = this.config.targets.filter(
      (t) =>
        t.repositoryId === payload.repository?.id &&
        t.repository.toLowerCase() ===
          String(payload.repository?.full_name).toLowerCase(),
    );
    if (!targets.length) return;
    const token = await this.github.appToken();
    let reviewRunId = payload.workflow_run?.id;
    if (event === "deployment_review") {
      reviewRunId =
        payload.workflow_run?.id ??
        (Number.isSafeInteger(payload.workflow_job_run?.id)
          ? (
              await this.github.request(
                "/repos/" +
                  targets[0].repository +
                  "/actions/jobs/" +
                  payload.workflow_job_run.id,
                token,
              )
            ).run_id
          : undefined);
      if (!Number.isSafeInteger(reviewRunId) || reviewRunId <= 0)
        throw new Error("Review event has no workflow run identity");
    }
    if (event === "deployment_review" && payload.action === "requested") {
      const runId = reviewRunId;
      for (const target of targets.filter(
        (t) => t.environment === payload.environment,
      )) {
        try {
          const { run } = await this.github.pending(target, runId, token);
          this.store.candidate({
            repository: target.repository,
            repositoryId: target.repositoryId,
            environment: target.environment,
            environmentId: target.environmentId,
            runId,
            runAttempt: run.run_attempt,
            sha: run.head_sha,
            label: target.label,
            channelId: target.channelId,
            runUrl:
              "https://github.com/" +
              target.repository +
              "/actions/runs/" +
              runId,
          });
        } catch (err) {
          if (
            !(err instanceof ExpectedError) ||
            !["release_superseded", "release_no_longer_pending"].includes(
              err.code,
            )
          )
            throw err;
        }
      }
    }
    const cards = this.store
      .cards()
      .filter(
        (c) =>
          targets.some((t) => t.environmentId === c.environmentId) &&
          c.repositoryId === payload.repository.id,
      );
    if (
      event === "deployment_review" &&
      ["approved", "rejected"].includes(payload.action)
    ) {
      for (const card of cards.filter((c) => c.runId === reviewRunId)) {
        const history = await this.github.request(
          "/repos/" +
            card.repository +
            "/actions/runs/" +
            card.runId +
            "/approvals",
          token,
        );
        const matching = history.filter((h: any) =>
          h.environments?.some(
            (e: any) =>
              e.id === card.environmentId && e.name === card.environment,
          ),
        );
        if (
          matching.length === 1 &&
          ["approved", "rejected"].includes(matching[0].state) &&
          ["pending", "deciding"].includes(card.phase)
        )
          this.store.update(card, {
            phase: matching[0].state,
            detail:
              matching[0].state === "approved"
                ? "Approved; waiting for deployment"
                : "Release rejected",
          });
      }
    }
    if (event === "workflow_run" && payload.action === "completed") {
      for (const card of cards.filter(
        (c) =>
          c.runId === payload.workflow_run?.id &&
          !["succeeded", "failed", "rejected", "cancelled"].includes(c.phase),
      )) {
        const run = await this.github.request(
          "/repos/" + card.repository + "/actions/runs/" + card.runId,
          token,
        );
        if (
          run.status !== "completed" ||
          run.run_attempt !== card.runAttempt ||
          run.head_sha !== card.sha
        )
          continue;
        // A successful workflow is not itself evidence that the host deployed.
        if (run.conclusion !== "success")
          this.store.update(card, {
            phase: run.conclusion === "cancelled" ? "cancelled" : "failed",
            detail: "Workflow " + run.conclusion,
          });
      }
    }
    if (["status", "deployment_review", "workflow_run"].includes(event)) {
      for (const card of this.store
        .cards()
        .filter(
          (c) =>
            targets.some(
              (t) =>
                t.repositoryId === c.repositoryId &&
                t.environmentId === c.environmentId,
            ) &&
            (c.sha === payload.sha || c.runId === reviewRunId) &&
            ["approved", "deciding", "deploying"].includes(c.phase),
        )) {
        const target = this.target(card);
        const expected =
          "release/" +
          target.releaseTarget +
          "/" +
          card.runId +
          "/" +
          card.runAttempt;
        let status: any;
        for (let page = 1; page <= 10; page++) {
          const statuses = await this.github.request(
            "/repos/" +
              card.repository +
              "/commits/" +
              card.sha +
              "/statuses?per_page=100&page=" +
              page,
            token,
          );
          status = statuses.find(
            (s: any) =>
              s.context === expected && s.creator?.id === target.statusActorId,
          );
          if (status || statuses.length < 100) break;
          if (page === 10) throw new Error("Status pagination limit reached");
        }
        if (!status) continue;
        if (
          status.state === "success" &&
          /^deployed sha256:[a-f0-9]{64}$/.test(status.description)
        )
          this.store.update(card, {
            phase: "succeeded",
            detail: status.description,
          });
        else if (["failure", "error"].includes(status.state))
          this.store.update(card, {
            phase: "failed",
            detail: "Deployment failed. Inspect the workflow.",
          });
        else if (status.state === "pending")
          this.store.update(card, {
            phase: "deploying",
            detail: "Deployment in progress",
          });
      }
    }
    this.notify();
  }
}
