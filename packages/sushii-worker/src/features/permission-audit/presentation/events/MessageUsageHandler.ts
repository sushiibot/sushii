import type { Message } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

import type { PermissionUsageRecorder } from "../../application/PermissionUsageRecorder";

export class MessageUsageHandler extends EventHandler<Events.MessageCreate> {
  readonly eventType = Events.MessageCreate;

  constructor(
    private readonly recorder: PermissionUsageRecorder,
    private readonly deploymentService: DeploymentService,
  ) {
    super();
  }

  async handle(message: Message): Promise<void> {
    if (!message.inGuild() || message.webhookId || message.system) {
      return;
    }

    // Both blue and green deployments receive events in exempt channels.
    if (
      this.deploymentService.isChannelExemptFromDeploymentCheck(
        message.channelId,
      )
    ) {
      return;
    }

    const mentionsNonMentionableRole = message.mentions.roles.some(
      (role) => !role.mentionable,
    );

    if (
      !message.mentions.everyone &&
      !mentionsNonMentionableRole &&
      !message.tts
    ) {
      return;
    }

    await this.recorder.recordMessage({
      guildId: message.guildId,
      authorId: message.author.id,
      channelId: message.channelId,
      occurredAt: message.createdAt,
      mentionsEveryone: message.mentions.everyone,
      mentionsNonMentionableRole,
      tts: message.tts,
    });
  }
}
