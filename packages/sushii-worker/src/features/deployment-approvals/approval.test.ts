import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction, Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { scrubUrl } from "@/shared/infrastructure/logRedaction";

import type { ApprovalClient } from "./client";
import { type Candidate } from "./client";
import { DeploymentApprovalButtonHandler } from "./handler";
import { DeploymentApprovalPublisher } from "./publisher";
import { confirmationCard, releaseCard } from "./views";

const card: Candidate = {
  id: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  createdAt: Date.now(),
  repository: "owner/app",
  repositoryId: 1,
  environment: "production",
  environmentId: 2,
  runId: 10,
  runAttempt: 1,
  sha: "a".repeat(40),
  label: "App @everyone",
  channelId: "111111111111111111",
  runUrl: "https://evil.invalid/ignored",
  phase: "pending",
  detail: "Ready",
};

describe("deployment approval UI", () => {
  test("release and confirmation link the deployed source to the candidate", () => {
    const previousSha = "b".repeat(40);
    const candidate = { ...card, previousSha };
    const compare =
      "https://github.com/owner/app/compare/" + previousSha + "..." + card.sha;
    expect(JSON.stringify(releaseCard(candidate))).toContain(compare);
    expect(
      JSON.stringify(confirmationCard(candidate, "x".repeat(43), "approved")),
    ).toContain(compare);
    expect(JSON.stringify(releaseCard(card))).toContain(
      "Previous deployed commit is not recorded.",
    );
    expect(JSON.stringify(releaseCard(card))).not.toContain("/compare/");
  });

  test("links derive from verified identifiers and messages suppress mentions", () => {
    const payload = releaseCard(card);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(payload)).not.toContain("evil.invalid");
    expect(JSON.stringify(payload)).toContain("/actions/runs/10");
    const frozen = JSON.stringify(releaseCard({ ...card, phase: "approved" }));
    expect(frozen).not.toContain("/review/");
    expect(frozen).toContain('"disabled":true');
  });
  test("confirmation displays full immutable source and unique decision token", () => {
    const payload = JSON.stringify(
      confirmationCard(card, "x".repeat(43), "approved"),
    );
    expect(payload).toContain(card.sha);
    expect(payload).toContain("/confirm/" + "x".repeat(43));
  });
  test("non-owner buttons never reach backend", async () => {
    const post = mock(async () => ({}));
    const api = { post } as unknown as ApprovalClient;
    const handler = new DeploymentApprovalButtonHandler(
      api,
      "222222222222222222",
    );
    const reply = mock(async () => undefined);
    await handler.handleInteraction({
      user: { id: "other" },
      reply,
    } as unknown as ButtonInteraction);
    expect(post).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
  });
  test("pending updates edit the same recovered message without starting a thread", async () => {
    const ack = mock(async (_path: string, _body: unknown) => ({}));
    const post = mock(async () => ({ id: "333333333333333333" }));
    const patch = mock(async () => ({}));
    const get = mock(async () => [
      {
        id: "333333333333333333",
        author: { id: "bot" },
        components: releaseCard(card).components,
      },
    ]);
    const client = {
      rest: { get, post, patch },
      user: { id: "bot" },
    } as unknown as Client;
    const publisher = new DeploymentApprovalPublisher(
      { post: ack, consumerId: "consumer" } as unknown as ApprovalClient,
      client,
      {} as DeploymentService,
      {} as Logger,
    );
    await publisher.publish(card);
    expect(post).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0][1]).toMatchObject({
      messageId: "333333333333333333",
      revision: 1,
    });
  });
  test("thread status recovery edits instead of duplicating a reply", async () => {
    const ack = mock(async (_path: string, _body: unknown) => ({}));
    const post = mock(async () => ({}));
    const patch = mock(async () => ({}));
    const get = mock(async (path: string) =>
      path.endsWith("/messages")
        ? [
            {
              id: "444444444444444444",
              author: { id: "bot" },
              content: "https://github.com/owner/app/actions/runs/10",
            },
          ]
        : { id: "333333333333333333" },
    );
    const client = {
      rest: { get, post, patch },
      user: { id: "bot" },
    } as unknown as Client;
    const publisher = new DeploymentApprovalPublisher(
      { post: ack, consumerId: "consumer" } as unknown as ApprovalClient,
      client,
      {} as DeploymentService,
      {} as Logger,
    );
    await publisher.publish({
      ...card,
      phase: "succeeded",
      messageId: "333333333333333333",
    });
    expect(post).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(ack.mock.calls[0][1]).toMatchObject({
      threadMessageId: "444444444444444444",
    });
  });
});

test("approval and OAuth credentials are removed from telemetry strings", () => {
  expect(scrubUrl("/deploy-approval/confirm/secret_token")).toBe(
    "/deploy-approval/confirm/REDACTED",
  );
  expect(
    scrubUrl("https://private/oauth/callback?code=secret&state=secret"),
  ).not.toContain("secret");
});
test("a broken Discord card does not block other services", async () => {
  const publisher = new DeploymentApprovalPublisher(
    {} as ApprovalClient,
    {} as Client,
    { isCurrentDeploymentActive: () => true } as DeploymentService,
    { warn: mock(() => undefined) } as unknown as Logger,
  );
  const seen: string[] = [];
  publisher.publish = async (item) => {
    seen.push(item.id);
    if (item.id === card.id) throw new Error("Missing channel");
  };
  expect(await publisher.deliver([card, { ...card, id: "other" }])).toBe(false);
  expect(seen).toEqual([card.id, "other"]);
});

test("automatic target cards never render approval buttons", () => {
  const payload = releaseCard({
    ...card,
    environmentId: "release:production",
    phase: "deploying",
  });
  expect(JSON.stringify(payload)).not.toContain("Review & approve");
  expect(JSON.stringify(payload)).not.toContain("/deploy-approval/review/");
});
