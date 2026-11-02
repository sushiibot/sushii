import { type ButtonInteraction, type Client, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import { REVIEW_CHANNEL_ID } from "@/features/automod/constants";

import type { IpGrabberRepository } from "../domain/IpGrabberRepository";
import { buildIpGrabberReviewMessage } from "../presentation/views/IpGrabberReviewView";

/**
 * Posts newly added domains to the owner review channel. Runs on the cluster
 * that has the channel, since domains are found on every cluster.
 */
export class IpGrabberReviewService {
  constructor(
    private readonly client: Client,
    private readonly repository: IpGrabberRepository,
    private readonly logger: Logger,
  ) {}

  async postPendingReviews(): Promise<void> {
    const channel = this.client.channels.cache.get(REVIEW_CHANNEL_ID);
    if (!channel || !channel.isSendable()) {
      return;
    }

    for (const domain of await this.repository.listPendingReviews()) {
      try {
        const message = await channel.send(buildIpGrabberReviewMessage(domain));
        await this.repository.markReviewPosted(domain.hostname, message.id);
      } catch (err) {
        this.logger.error(
          { err, hostname: domain.hostname },
          "Failed to post IP grabber review",
        );
      }
    }
  }

  async handleRevert(
    hostname: string,
    interaction: ButtonInteraction,
  ): Promise<void> {
    const reverted = await this.repository.revert(hostname);
    if (!reverted) {
      await interaction.reply({
        content: "This domain was already reverted.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const domain = await this.repository.findDomain(hostname);
    if (!domain) {
      throw new Error("Reverted IP grabber domain is missing", {
        cause: { hostname },
      });
    }

    await interaction.update(
      buildIpGrabberReviewMessage(domain, {
        userId: interaction.user.id,
        at: new Date(),
      }),
    );

    this.logger.info(
      { hostname, executorId: interaction.user.id },
      "IP grabber domain reverted",
    );
  }
}
