import { sleep } from "bun";
import { type APIMessage, type Client, Routes } from "discord.js";
import { createHash } from "node:crypto";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

import type { ApprovalClient } from "./client";
import { type Candidate } from "./client";
import {
  STATUS_EMOJI_NAMES,
  matchesStatusReply,
  releaseCard,
  statusReply,
} from "./views";

function nonce(id: string): string {
  return BigInt(
    "0x" + createHash("sha256").update(id).digest("hex").slice(0, 16),
  ).toString();
}

export class DeploymentApprovalPublisher {
  private readonly identities = new Map<
    string,
    { messageId: string; threadMessageId?: string }
  >();
  private stopped = false;
  private controller?: AbortController;
  constructor(
    private readonly api: ApprovalClient,
    private readonly client: Client,
    private readonly deployment: DeploymentService,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
  ) {}
  stop() {
    this.stopped = true;
    this.controller?.abort();
  }
  async run(): Promise<void> {
    while (!this.stopped) {
      if (!this.deployment.isCurrentDeploymentActive()) {
        await sleep(3000);
        continue;
      }
      this.controller = new AbortController();
      try {
        for await (const cards of this.api.events(this.controller.signal)) {
          if (!this.deployment.isCurrentDeploymentActive()) break;
          if (!(await this.deliver(cards))) break;
        }
      } catch (err) {
        if (!this.stopped)
          this.logger.warn(
            { err },
            "Deployment approval event delivery interrupted",
          );
      } finally {
        this.controller.abort();
      }
      if (!this.stopped) await sleep(5000); // Reconnect the private event stream; never poll GitHub.
    }
  }
  async deliver(cards: Candidate[]): Promise<boolean> {
    let healthy = true;
    for (const card of cards) {
      if (!this.deployment.isCurrentDeploymentActive()) break;
      try {
        await this.publish(card);
      } catch (err) {
        healthy = false;
        this.logger.warn(
          { err, cardId: card.id },
          "Deployment approval message delivery failed",
        );
      }
    }
    return healthy;
  }
  private async recover(
    channelId: string,
    card: Candidate,
    thread: boolean,
  ): Promise<string | undefined> {
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ limit: "100" });
      if (before) query.set("before", before);
      const messages = (await this.client.rest.get(
        Routes.channelMessages(channelId),
        { query },
      )) as APIMessage[];
      const found = messages.find(
        (m) =>
          m.author.id === this.client.user?.id &&
          (thread
            ? matchesStatusReply(m.content ?? "", card)
            : JSON.stringify(m.components ?? []).includes(card.id)),
      );
      if (found) return found.id;
      if (
        messages.length < 100 ||
        Date.parse(messages[messages.length - 1].timestamp) <
          card.createdAt - 5000
      )
        return undefined;
      before = messages[messages.length - 1].id;
    }
    throw new Error(
      "Cannot safely recover release message within history limit",
    );
  }
  async publish(card: Candidate) {
    const emojis = await this.emojiRepo.getEmojis(STATUS_EMOJI_NAMES);
    const known = this.identities.get(card.id);
    let messageId = card.messageId ?? known?.messageId;
    let threadMessageId = card.threadMessageId ?? known?.threadMessageId;
    if (!messageId) messageId = await this.recover(card.channelId, card, false);
    if (!messageId) {
      const result = (await this.client.rest.post(
        Routes.channelMessages(card.channelId),
        {
          body: {
            ...releaseCard(card, emojis),
            nonce: nonce("card:" + card.id),
            enforce_nonce: true,
          },
        },
      )) as APIMessage;
      messageId = result.id;
      this.identities.set(card.id, { messageId });
      await this.api.post("/internal/ack", {
        client: this.api.consumerId,
        id: card.id,
        revision: 0,
        messageId,
      });
    } else {
      await this.client.rest.patch(
        Routes.channelMessage(card.channelId, messageId),
        { body: releaseCard(card, emojis) },
      );
    }
    if (!["pending", "stale", "deciding"].includes(card.phase)) {
      // Threads created from a message use that message's ID, so creation is recoverable.
      try {
        await this.client.rest.get(Routes.channel(messageId));
      } catch (err) {
        if (
          !(
            err &&
            typeof err === "object" &&
            "code" in err &&
            err.code === 10003
          )
        )
          throw err;
        await this.client.rest.post(Routes.threads(card.channelId, messageId), {
          body: {
            name: (card.label + " · " + card.sha.slice(0, 7)).slice(0, 100),
            auto_archive_duration: 1440,
          },
        });
      }
      const body = statusReply(card, emojis);
      // The persisted ID may belong to an earlier phase. Recover this phase explicitly,
      // including after a restart or a lost acknowledgement, before posting a new reply.
      threadMessageId = await this.recover(messageId, card, true);
      if (threadMessageId) {
        await this.client.rest.patch(
          Routes.channelMessage(messageId, threadMessageId),
          { body },
        );
      } else {
        const result = (await this.client.rest.post(
          Routes.channelMessages(messageId),
          {
            body: {
              ...body,
              nonce: nonce(
                "thread:" + card.id + ":" + card.runAttempt + ":" + card.phase,
              ),
              enforce_nonce: true,
            },
          },
        )) as APIMessage;
        threadMessageId = result.id;
      }
    }
    this.identities.set(card.id, { messageId, threadMessageId });
    await this.api.post("/internal/ack", {
      client: this.api.consumerId,
      id: card.id,
      revision: card.revision,
      messageId,
      threadMessageId,
    });
  }
}
