import { RelayQueue } from "./relay";
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalService } from "./service";
import { Store } from "./store";
import { GitHub } from "./github";
import { backendHandler, relayHandler } from "./http";
import { digest, TokenCipher, validSignature } from "./security";
import {
  ExpectedError,
  type Config,
  type Candidate,
  type Target,
} from "./types";

const target: Target = {
  repository: "owner/app",
  repositoryId: 1,
  environment: "production",
  environmentId: 2,
  workflow: ".github/workflows/ci.yml",
  branch: "main",
  channelId: "111111111111111111",
  label: "Example",
  releaseTarget: "production",
  statusActorId: 99,
};
const config: Config = {
  ownerDiscordId: "222222222222222222",
  clientId: "client",
  clientSecret: "secret",
  appId: 4,
  appPrivateKey: "unused",
  installationId: 5,
  callbackUrl: "https://private.example/oauth/callback",
  botToken: "b".repeat(40),
  relayToken: "r".repeat(40),
  webhookSecret: "w".repeat(40),
  encryptionKey: "a".repeat(64),
  targets: [target],
};
const dbs: Store[] = [];
afterEach(() => {
  for (const s of dbs.splice(0)) s.db.close();
});
function fixture() {
  const store = new Store(":memory:");
  dbs.push(store);
  const run = {
    id: 10,
    repository: { id: 1 },
    head_repository: { id: 1 },
    event: "push",
    head_branch: "main",
    path: target.workflow,
    run_attempt: 1,
    head_sha: "a".repeat(40),
    status: "waiting",
    conclusion: null as string | null,
  };
  const gate = {
    environment: { id: 2, name: "production" },
    current_user_can_approve: true,
  };
  const history: any[] = [];
  const statuses: any[] = [];
  const posts: any[] = [];
  const oauthCalls: any[] = [];
  let postError = false;
  const gh = new GitHub(config);
  gh.appToken = async () => "app-token";
  gh.oauth = async (params) => {
    oauthCalls.push(params);
    return {
      access_token: "user-token",
      refresh_token: "refresh",
      expiresAt: Date.now() + 3600000,
      refreshExpiresAt: Date.now() + 7200000,
    };
  };
  gh.request = async (path, token, method, body) => {
    if (path === "/user") return { id: 3 };
    if (path.endsWith("/approvals")) return history;
    if (path.includes("/statuses?")) return statuses;
    if (path.endsWith("/pending_deployments")) {
      if (method === "POST") {
        posts.push({ path, token, body });
        if (postError) throw new Error("network lost");
        return [];
      }
      return [gate];
    }
    if (path.endsWith("/commits/main")) return { sha: run.head_sha };
    if (path.endsWith("/actions/runs/" + run.id)) return run;
    throw new Error("Unexpected API path: " + path);
  };
  const service = new ApprovalService(config, store, gh);
  store.putSecret(
    config.ownerDiscordId,
    service.cipher.encrypt(
      {
        githubUserId: 3,
        access_token: "user-token",
        refresh_token: "refresh",
        expiresAt: Date.now() + 3600000,
        refreshExpiresAt: Date.now() + 7200000,
      },
      config.ownerDiscordId,
    ),
  );
  const payload = () => ({
    action: "requested",
    environment: "production",
    installation: { id: 5 },
    repository: { id: 1, full_name: "owner/app" },
    workflow_run: { id: run.id },
  });
  return {
    service,
    store,
    run,
    gate,
    history,
    statuses,
    posts,
    oauthCalls,
    payload,
    setPostError: () => {
      postError = true;
    },
  };
}
async function pending(f: ReturnType<typeof fixture>) {
  await f.service.event("deployment_review", f.payload());
  return f.store.cards()[0];
}
describe("approval binding and message lifecycle", () => {
  test("updates one pending card, freezes after approval, and creates the next card", async () => {
    const f = fixture();
    const first = await pending(f);
    f.run.id = 11;
    f.run.head_sha = "b".repeat(40);
    const next = await pending(f);
    expect(next.id).toBe(first.id);
    expect(next.revision).toBe(2);
    expect(f.store.cards()).toHaveLength(1);
    const review = await f.service.review(
      config.ownerDiscordId,
      next.id,
      next.revision,
      "approved",
    );
    await f.service.decide(config.ownerDiscordId, review.confirmation);
    expect(f.posts[0].token).toBe("user-token");
    expect(f.posts[0].body.environment_ids).toEqual([2]);
    expect(f.store.card(next.id)?.phase).toBe("approved");
    f.run.id = 12;
    f.run.head_sha = "c".repeat(40);
    await pending(f);
    expect(f.store.cards()).toHaveLength(2);
    expect(f.store.card(next.id)?.sha).toBe("b".repeat(40));
  });
  test("duplicate and out-of-order deliveries do not replace a newer candidate", async () => {
    const f = fixture();
    await pending(f);
    await pending(f);
    expect(f.store.cards()[0].revision).toBe(1);
    f.run.id = 12;
    await pending(f);
    f.run.id = 11;
    await pending(f);
    expect(f.store.cards()[0].runId).toBe(12);
  });
  test("replacement invalidates an existing confirmation", async () => {
    const f = fixture();
    const card = await pending(f);
    const review = await f.service.review(
      config.ownerDiscordId,
      card.id,
      card.revision,
      "approved",
    );
    f.run.id = 11;
    f.run.head_sha = "b".repeat(40);
    await pending(f);
    await expect(
      f.service.decide(config.ownerDiscordId, review.confirmation),
    ).rejects.toThrow("release_changed");
    expect(f.posts).toHaveLength(0);
  });
  test("owner, live reviewer eligibility and current attempt are enforced", async () => {
    const f = fixture();
    const card = await pending(f);
    await expect(
      f.service.review("other", card.id, 1, "approved"),
    ).rejects.toThrow("not_authorized");
    f.gate.current_user_can_approve = false;
    await expect(
      f.service.review(config.ownerDiscordId, card.id, 1, "approved"),
    ).rejects.toThrow("release_not_approvable");
    f.gate.current_user_can_approve = true;
    f.run.run_attempt = 2;
    await expect(
      f.service.review(config.ownerDiscordId, card.id, 1, "approved"),
    ).rejects.toThrow("release_no_longer_pending");
    expect(f.posts).toHaveLength(0);
  });
  test("confirmation is single-use and ambiguous POST is never retried", async () => {
    const f = fixture();
    const card = await pending(f);
    const review = await f.service.review(
      config.ownerDiscordId,
      card.id,
      1,
      "approved",
    );
    f.setPostError();
    await expect(
      f.service.decide(config.ownerDiscordId, review.confirmation),
    ).rejects.toThrow("approval_result_uncertain");
    await expect(
      f.service.decide(config.ownerDiscordId, review.confirmation),
    ).rejects.toThrow("confirmation_expired");
    expect(f.posts).toHaveLength(1);
    expect(f.store.card(card.id)?.phase).toBe("deciding");
  });
  test("GitHub-side approval followed by exact host receipt completes the same card", async () => {
    const f = fixture();
    const card = await pending(f);
    f.history.push({
      state: "approved",
      environments: [{ id: 2, name: "production" }],
      user: { id: 3 },
    });
    await f.service.event("deployment_review", {
      ...f.payload(),
      action: "approved",
    });
    expect(f.store.card(card.id)?.phase).toBe("approved");
    f.statuses.push({
      context: "release/production/10/1",
      state: "success",
      creator: { id: 99 },
      description: "deployed sha256:" + "f".repeat(64),
    });
    await f.service.event("status", { ...f.payload(), sha: card.sha });
    expect(f.store.card(card.id)?.phase).toBe("succeeded");
    expect(f.store.deployed(1, 2)).toBe(card.sha);
  });
  test("workflow success or another actor's receipt never claims host success", async () => {
    const f = fixture();
    const card = await pending(f);
    f.store.update(card, { phase: "approved" });
    f.statuses.push({
      context: "release/production/10/1",
      state: "success",
      creator: { id: 98 },
      description: "deployed sha256:" + "f".repeat(64),
    });
    f.run.status = "completed";
    f.run.conclusion = "success";
    await f.service.event("workflow_run", {
      ...f.payload(),
      action: "completed",
    });
    expect(f.store.card(card.id)?.phase).toBe("approved");
    expect(f.store.deployed(1, 2)).toBeUndefined();
  });
  test("message identity survives replacement racing with acknowledgement", async () => {
    const f = fixture();
    const first = await pending(f);
    f.run.id = 11;
    await pending(f);
    f.store.ack(first.id, 1, "333333333333333333");
    expect(f.store.changed()[0].messageId).toBe("333333333333333333");
    expect(f.store.changed()[0].revision).toBe(2);
  });
});
describe("OAuth and exposed boundaries", () => {
  test("cipher authenticates ciphertext and its Discord identity", () => {
    const cipher = new TokenCipher(config.encryptionKey);
    const encrypted = cipher.encrypt({ token: "secret" }, "owner");
    expect(encrypted).not.toContain("secret");
    expect(cipher.decrypt(encrypted, "owner")).toEqual({ token: "secret" });
    expect(() => cipher.decrypt(encrypted, "other")).toThrow();
  });
  test("OAuth uses PKCE, browser binding and single-use state", async () => {
    const f = fixture();
    const link = new URL(f.service.link(config.ownerDiscordId));
    const { url, browser } = f.service.start(link.searchParams.get("ticket")!);
    const auth = new URL(url);
    const state = auth.searchParams.get("state")!;
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    await f.service.callback(state, "code", browser);
    expect(f.oauthCalls[0].code_verifier).toHaveLength(43);
    await expect(f.service.callback(state, "code", browser)).rejects.toThrow(
      "link_expired",
    );
    const next = f.service.start(
      new URL(f.service.link(config.ownerDiscordId)).searchParams.get(
        "ticket",
      )!,
    );
    await expect(
      f.service.callback(
        new URL(next.url).searchParams.get("state")!,
        "code",
        "wrong",
      ),
    ).rejects.toThrow("invalid_oauth_state");
  });
  test("revocation deletes the stored user credential", async () => {
    const f = fixture();
    await f.service.event("github_app_authorization", {
      action: "revoked",
      sender: { id: 3 },
    });
    expect(f.store.secret(config.ownerDiscordId)).toBeUndefined();
  });
  test("public relay cannot route OAuth or approval requests and verifies raw signatures", async () => {
    let forwarded = 0;
    const queue = new RelayQueue(":memory:");
    const relay = relayHandler({ secret: config.webhookSecret }, queue);
    const forward = (async (url: any, init: any) => {
      forwarded++;
      expect(new URL(url).pathname).toBe("/internal/github");
      expect(init.headers.authorization).toBe("Bearer " + config.relayToken);
      return Response.json({}, { status: 202 });
    }) as typeof fetch;
    for (const path of ["/oauth/start", "/oauth/callback", "/internal/decide"])
      expect(
        (await relay(new Request("https://public" + path, { method: "POST" })))
          .status,
      ).toBe(404);
    const body = JSON.stringify({ action: "requested" });
    const headers = {
      "x-github-event": "deployment_review",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256":
        "sha256=" +
        createHmac("sha256", config.webhookSecret).update(body).digest("hex"),
    };
    expect(
      (
        await relay(
          new Request("https://public/github/webhook", {
            method: "POST",
            headers,
            body: body + " ",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await relay(
          new Request("https://public/github/webhook", {
            method: "POST",
            headers,
            body,
          }),
        )
      ).status,
    ).toBe(202);
    expect(forwarded).toBe(0);
    await queue.drain(
      new URL("http://private:3080/internal/github"),
      config.relayToken,
      forward,
    );
    expect(forwarded).toBe(1);
    queue.close();
  });
  test("relay token cannot approve; duplicate signed deliveries persist once", async () => {
    const f = fixture();
    const handler = backendHandler(f.service);
    expect(
      (
        await handler(
          new Request("http://private/internal/decide", {
            method: "POST",
            headers: { authorization: "Bearer " + config.relayToken },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
    const body = JSON.stringify(f.payload());
    const headers = {
      authorization: "Bearer " + config.relayToken,
      "x-github-event": "deployment_review",
      "x-github-delivery": "one",
      "x-hub-signature-256":
        "sha256=" +
        createHmac("sha256", config.webhookSecret).update(body).digest("hex"),
    };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await handler(
            new Request("http://private/internal/github", {
              method: "POST",
              headers,
              body,
            }),
          )
        ).status,
      ).toBe(202);
    await f.service.processInbox();
    expect(f.store.cards()).toHaveLength(1);
    expect(
      f.store.db.query("SELECT COUNT(*) AS count FROM inbox").get(),
    ).toEqual({ count: 1 });
  });
  test("official signature fixture", () => {
    expect(
      validSignature(
        Buffer.from("Hello, World!"),
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
        "It's a Secret to Everybody",
      ),
    ).toBe(true);
  });
});

test("a candidate arriving during final validation prevents the older approval", async () => {
  const f = fixture();
  const card = await pending(f);
  const review = await f.service.review(
    config.ownerDiscordId,
    card.id,
    1,
    "approved",
  );
  const original = f.service.github.pending.bind(f.service.github);
  f.service.github.pending = async (...args) => {
    const result = await original(...args);
    f.store.candidate({ ...card, runId: 11, sha: "b".repeat(40) });
    return result;
  };
  await expect(
    f.service.decide(config.ownerDiscordId, review.confirmation),
  ).rejects.toThrow("release_changed");
  expect(f.posts).toHaveLength(0);
  expect(f.store.card(card.id)?.phase).toBe("cancelled");
});
test("restart marks in-flight approval uncertain and never replays the POST", async () => {
  const f = fixture();
  const card = await pending(f);
  f.store.update(card, { phase: "deciding" });
  new ApprovalService(config, f.store, f.service.github);
  expect(f.store.card(card.id)?.detail).toContain("interrupted by restart");
  expect(f.posts).toHaveLength(0);
});
test("review payload without workflow_run resolves through its job", async () => {
  const f = fixture();
  const original = f.service.github.request.bind(f.service.github);
  f.service.github.request = async (path, ...args) =>
    path.endsWith("/actions/jobs/20")
      ? { run_id: 10 }
      : original(path, ...args);
  const payload = {
    ...f.payload(),
    workflow_run: null,
    workflow_job_run: { id: 20 },
  };
  await f.service.event("deployment_review", payload);
  f.history.push({
    state: "approved",
    environments: [{ id: 2, name: "production" }],
  });
  await f.service.event("deployment_review", {
    ...payload,
    action: "approved",
  });
  expect(f.store.cards()[0].phase).toBe("approved");
});
test("durable relay survives restart and backend outage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "approval-relay-"));
  let queue = new RelayQueue(join(dir, "queue.db"));
  try {
    queue.enqueue("one", "ping", "signature", Buffer.from("{}"));
    await queue.drain(
      new URL("http://backend/internal/github"),
      "token",
      (async () =>
        new Response(null, { status: 503 })) as unknown as typeof fetch,
    );
    expect(queue.pending()).toBe(1);
    queue.close();
    queue = new RelayQueue(join(dir, "queue.db"));
    expect(queue.pending()).toBe(1);
    queue.enqueue("one", "ping", "signature", Buffer.from("{}"));
    expect(queue.pending()).toBe(1);
  } finally {
    queue.close();
    rmSync(dir, { recursive: true });
  }
});
test("persisted inbox continues beyond eight failures", async () => {
  const f = fixture();
  f.service.enqueue("one", "deployment_review", JSON.stringify(f.payload()));
  f.store.db.exec("UPDATE inbox SET attempts=9");
  await f.service.processInbox();
  expect(f.store.cards()).toHaveLength(1);
});

test("SSE cancellation releases the consumer lease without double-closing", async () => {
  const f = fixture();
  const id = "00000000-0000-4000-8000-000000000001";
  const card = await pending(f);
  f.store.ack(card.id, card.revision, "333333333333333333");
  expect(f.store.changed()).toHaveLength(0);
  const response = await backendHandler(f.service)(
    new Request("http://private/internal/events?client=" + id, {
      headers: { authorization: "Bearer " + config.botToken },
    }),
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain(card.id); // A new renderer refreshes even acknowledged pending cards.
  await reader.cancel();
  expect(f.service.listeners.size).toBe(0);
  expect(f.store.claim("different-consumer")).toBe(true);
});

test("OAuth links the selected GitHub account and revocation follows that account", async () => {
  const f = fixture();
  const request = f.service.github.request.bind(f.service.github);
  f.service.github.request = async (path, ...args) =>
    path === "/user" ? { id: 4021761 } : request(path, ...args);
  const start = f.service.start(
    new URL(f.service.link(config.ownerDiscordId)).searchParams.get("ticket")!,
  );
  await f.service.callback(
    new URL(start.url).searchParams.get("state")!,
    "code",
    start.browser,
  );
  const account = f.service.cipher.decrypt<any>(
    f.store.secret(config.ownerDiscordId)!,
    config.ownerDiscordId,
  );
  expect(account.githubUserId).toBe(4021761);
  await expect(f.service.userToken()).resolves.toBe("user-token");
  await f.service.event("github_app_authorization", {
    action: "revoked",
    sender: { id: 3 },
  });
  expect(f.store.secret(config.ownerDiscordId)).toBeDefined();
  // Refresh keeps the linked identity instead of reverting to a configured account.
  account.expiresAt = 0;
  f.store.putSecret(
    config.ownerDiscordId,
    f.service.cipher.encrypt(account, config.ownerDiscordId),
  );
  await expect(f.service.userToken()).resolves.toBe("user-token");
  expect(
    f.service.cipher.decrypt<any>(
      f.store.secret(config.ownerDiscordId)!,
      config.ownerDiscordId,
    ).githubUserId,
  ).toBe(4021761);
  await f.service.event("github_app_authorization", {
    action: "revoked",
    sender: { id: 4021761 },
  });
  expect(f.store.secret(config.ownerDiscordId)).toBeUndefined();
});

test("deployed baseline survives restart and updates pending comparisons without regressing", async () => {
  const f = fixture();
  const old = "b".repeat(40),
    next = "c".repeat(40);
  f.store.recordDeployment(1, 2, old, 0);
  await f.service.event("deployment_review", f.payload());
  let card = f.store.cards()[0];
  expect(card.previousSha).toBe(old);
  const revision = card.revision;
  f.store.recordDeployment(1, 2, next, 9);
  card = f.store.cards()[0];
  expect(card.previousSha).toBe(next);
  expect(card.revision).toBeGreaterThan(revision);
  new ApprovalService(
    { ...config, targets: [{ ...target, initialDeployedSha: old }] },
    f.store,
    f.service.github,
  );
  f.store.recordDeployment(1, 2, old, 0); // Bootstrap on restart is not a rollback.
  f.store.recordDeployment(1, 2, old, 8); // Late older receipt cannot regress it.
  expect(f.store.deployed(1, 2)).toBe(next);
  expect(f.store.deployed(1, 99)).toBeUndefined();
});

describe("automatic release notifications", () => {
  function automatic() {
    const f = fixture();
    const service = new ApprovalService(
      {
        ...config,
        targets: [
          {
            ...target,
            mode: "automatic",
            environmentId: "release:production",
            sourceEvents: ["push", "workflow_dispatch"],
          },
        ],
      },
      f.store,
      f.service.github,
    );
    const payload = () => ({
      ...f.payload(),
      sha: f.run.head_sha,
      context: `release/production/${f.run.id}/${f.run.run_attempt}`,
    });
    const status = (state: string) => ({
      context: payload().context,
      creator: { id: 99 },
      state,
      description:
        state === "success"
          ? "deployed sha256:" + "b".repeat(64)
          : "Waiting for authenticated deployment receipt",
    });
    return { ...f, service, payload, status };
  }
  test("trusted automatic receipt creates and completes one card without an approval gate", async () => {
    const f = automatic();
    f.statuses.push(f.status("pending"));
    await f.service.event("status", f.payload());
    const card = f.store.cards()[0];
    expect(card.phase).toBe("deploying");
    expect(card.environmentId).toBe("release:production");
    await expect(
      f.service.review(
        config.ownerDiscordId,
        card.id,
        card.revision,
        "approved",
      ),
    ).rejects.toThrow("release_changed");
    f.statuses.unshift(f.status("success"));
    await f.service.event("status", f.payload());
    expect(f.store.cards()).toHaveLength(1);
    expect(f.store.card(card.id)?.phase).toBe("succeeded");
    expect(f.store.deployed(1, "release:production")).toBe(f.run.head_sha);
    f.statuses.unshift(f.status("pending"));
    await f.service.event("status", f.payload());
    expect(f.store.card(card.id)?.phase).toBe("succeeded");
  });
  test("success-first delivery works for allowed manual asset runs and isolates attempts", async () => {
    const f = automatic();
    f.run.event = "workflow_dispatch";
    f.run.run_attempt = 2;
    f.statuses.push(f.status("success"));
    await f.service.event("status", f.payload());
    expect(f.store.cards()[0]?.phase).toBe("succeeded");
    f.run.run_attempt = 3;
    f.statuses.unshift(f.status("pending"));
    await f.service.event("status", f.payload());
    expect(f.store.cards()).toHaveLength(2);
    expect(f.store.cards()[1].runAttempt).toBe(3);
  });
  test("untrusted actors, contexts, workflow and fork identity cannot create cards", async () => {
    const f = automatic();
    f.statuses.push({ ...f.status("success"), creator: { id: 123 } });
    await f.service.event("status", f.payload());
    expect(f.store.cards()).toHaveLength(0);
    f.statuses.unshift(f.status("success"));
    await f.service.event("status", {
      ...f.payload(),
      context: "release/other/10/1",
    });
    f.run.path = ".github/workflows/untrusted.yml";
    await f.service.event("status", f.payload());
    f.run.path = target.workflow;
    f.run.head_repository.id = 123;
    await f.service.event("status", f.payload());
    expect(f.store.cards()).toHaveLength(0);
  });
});

test("out-of-order release notices never compare against a later deployed commit", () => {
  const f = fixture();
  f.store.recordDeployment(1, "release:production", "b".repeat(40), 20);
  expect(f.store.deployed(1, "release:production", 10)).toBeUndefined();
  expect(f.store.deployed(1, "release:production", 21)).toBe("b".repeat(40));
});

test("blue/green completion requires the exact host-wait job and successful step", async () => {
  for (const valid of [false, true]) {
    const f = fixture();
    const service = new ApprovalService(
      {
        ...config,
        targets: [
          {
            ...target,
            mode: "approved",
            hostWaitJob: {
              name: "Deploy production",
              step: "Wait for host deploy",
            },
          },
        ],
      },
      f.store,
      f.service.github,
    );
    await service.event("deployment_review", f.payload());
    const original = service.github.request.bind(service.github);
    service.github.request = async (path, ...args) =>
      path.includes("/jobs?")
        ? {
            jobs: [
              {
                name: "Deploy production",
                run_id: 10,
                head_sha: f.run.head_sha,
                status: "completed",
                conclusion: "success",
                steps: [
                  {
                    name: "Wait for host deploy",
                    status: "completed",
                    conclusion: valid ? "success" : "skipped",
                  },
                ],
              },
            ],
          }
        : original(path, ...args);
    f.run.status = "completed";
    f.run.conclusion = "success";
    await service.event("workflow_run", {
      ...f.payload(),
      action: "completed",
    });
    expect(f.store.cards()[0].phase).toBe(valid ? "succeeded" : "failed");
  }
});

describe("pending card expiry", () => {
  const day = 24 * 60 * 60 * 1000;
  test("expires idle cards without GitHub polling, and new releases get fresh identities", async () => {
    const f = fixture();
    const first = await pending(f);
    const born = Date.now() - day;
    f.store.update(first, { createdAt: born });
    expect(f.store.expirePending(born + day - 1)).toBe(0);
    await f.service.processInbox();
    expect(f.store.card(first.id)?.phase).toBe("stale");
    const count = f.store.cards().length;
    await f.service.processInbox();
    expect(f.store.cards()).toHaveLength(count); // Quiet services do not post daily replacements.
    await f.service.event("deployment_review", f.payload());
    expect(f.store.cards()).toHaveLength(1); // Redelivery cannot reopen the same stale run.
    f.run.id = 11;
    f.run.head_sha = "b".repeat(40);
    await f.service.event("deployment_review", f.payload());
    const second = f.store.cards()[1];
    expect(second.id).not.toBe(first.id);
    expect(second.phase).toBe("pending");
    expect(second.messageId).toBeUndefined();
  });
  test("a confirmation issued before expiry cannot approve after the deadline", async () => {
    const f = fixture();
    const card = await pending(f);
    const confirmation = await f.service.review(
      config.ownerDiscordId,
      card.id,
      card.revision,
      "approved",
    );
    // Keep its revision unchanged to isolate the age guard from revision invalidation.
    f.store.save({ ...f.store.card(card.id)!, createdAt: Date.now() - day });
    await expect(
      f.service.decide(config.ownerDiscordId, confirmation.confirmation),
    ).rejects.toThrow("release_changed");
    expect(f.posts).toHaveLength(0);
    expect(f.store.card(card.id)?.phase).toBe("stale");
  });
  test("GitHub approval still advances a stale card", async () => {
    const f = fixture();
    const card = await pending(f);
    f.store.update(card, { createdAt: Date.now() - day });
    f.store.expirePending();
    f.history.push({
      state: "approved",
      environments: [{ id: 2, name: "production" }],
    });
    await f.service.event("deployment_review", {
      ...f.payload(),
      action: "approved",
    });
    expect(f.store.card(card.id)?.phase).toBe("approved");
  });
});
