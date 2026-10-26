import type { WebhookClient } from "discord.js";
import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { Logger } from "pino";

import Color from "@/utils/colors";

import type {
  Feedback,
  FeedbackPublisher,
  FeedbackReporter,
  PublishOutcome,
} from "../domain/Feedback";
import { FEATURE_LABELS, FEEDBACK_KIND_OPTIONS } from "../domain/Feedback";

const WEBHOOK_USERNAME = "sushii feedback";
const EMBED_DESCRIPTION_MAX = 4096;
const CODE_BLOCK_BODY_MAX = EMBED_DESCRIPTION_MAX - "```\n\n```".length;

/** Staff should see user text literally, never as rendered markdown or links. */
function literal(text: string): string {
  return escapeMarkdown(text, {
    heading: true,
    bulletedList: true,
    numberedList: true,
    maskedLink: true,
  });
}

/** A code block renders nothing inside it; a look-alike grave accent stops content from closing it early. */
function codeBlock(text: string): string {
  let body = text.replaceAll("`", "\u02CB");
  if (body.length > CODE_BLOCK_BODY_MAX) {
    let truncated = "";
    for (const char of body) {
      if (truncated.length + char.length > CODE_BLOCK_BODY_MAX - 1) {
        break;
      }
      truncated += char;
    }
    body = `${truncated}…`;
  }

  return `\`\`\`\n${body}\n\`\`\``;
}

export function buildFeedbackEmbed(
  feedback: Feedback,
  reporter: FeedbackReporter,
): EmbedBuilder {
  const title =
    feedback.source === "panel" && feedback.feature
      ? `Feedback: ${FEATURE_LABELS[feedback.feature]}`
      : "Feedback: error report";
  const kind = FEEDBACK_KIND_OPTIONS[feedback.kind];

  let server = "DM";
  if (feedback.guildId) {
    server = reporter.guildName
      ? `${literal(reporter.guildName)} (${feedback.guildId})`
      : feedback.guildId;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(codeBlock(feedback.content))
    .setColor(Color.Info)
    .addFields(
      { name: "Kind", value: `${kind.emoji} ${kind.label}`, inline: true },
      {
        name: "Reporter",
        value: `<@${feedback.userId}> ${literal(reporter.username)} (${feedback.userId})`,
        inline: true,
      },
      { name: "Server", value: server, inline: true },
    )
    .setTimestamp(feedback.createdAt);

  if (feedback.source === "error_report") {
    embed.addFields({
      name: "Error ID",
      value: feedback.traceId ? `\`\`\`${feedback.traceId}\`\`\`` : "None",
    });
  }

  return embed;
}

export class FeedbackWebhookPublisher implements FeedbackPublisher {
  /** `client` is null when FEEDBACK_WEBHOOK_URL is unset. */
  constructor(
    private readonly client: Pick<WebhookClient, "send"> | null,
    private readonly logger: Logger,
  ) {}

  async publish(
    feedback: Feedback,
    reporter: FeedbackReporter,
  ): Promise<PublishOutcome> {
    if (!this.client) {
      this.logger.info(
        { feedbackId: feedback.id },
        "FEEDBACK_WEBHOOK_URL not set, skipping feedback post",
      );
      return "not_configured";
    }

    await this.client.send({
      username: WEBHOOK_USERNAME,
      embeds: [buildFeedbackEmbed(feedback, reporter)],
      allowedMentions: { parse: [] },
    });
    return "published";
  }
}
