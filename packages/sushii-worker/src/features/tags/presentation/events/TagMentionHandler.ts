import type { Message } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { TagService } from "../../application/TagService";

export class TagMentionHandler extends EventHandler<Events.MessageCreate> {
  eventType = Events.MessageCreate as const;

  constructor(
    private readonly tagService: TagService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(msg: Message): Promise<void> {
    const botId = msg.client.user?.id;
    if (!botId) {
      return;
    }

    if (!msg.inGuild()) {
      return;
    }

    let content;
    const mentions = [`<@${botId}>`, `<@!${botId}>`];

    if (msg.content.startsWith(mentions[0])) {
      content = msg.content.replace(mentions[0], "").trim();
    } else if (msg.content.startsWith(mentions[1])) {
      content = msg.content.replace(mentions[1], "").trim();
    } else {
      return;
    }

    if (content.length === 0) {
      return;
    }

    try {
      const result = await this.tagService.useTag(content, msg.guildId);
      if (result.err) {
        return;
      }

      const tag = result.val;
      await msg.channel.send({
        content: tag.getDisplayContent(),
        allowedMentions: {
          parse: [],
        },
      });
    } catch (error) {
      this.logger.error(
        { error, guildId: msg.guildId, tagName: content },
        "Error handling tag mention",
      );
    }
  }
}
