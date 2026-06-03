import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import {
  buildAddId,
  buildIgnoreId,
} from "../handlers/scamCandidateCustomIds";
import type {
  StoredClassificationResult,
  StoredImageResult,
} from "../../domain/repositories/ScamCandidateRepository";

const MAX_REASON_DISPLAY_LENGTH = 200;

export interface ScamCandidateReviewViewOpts {
  userId: string;
  username: string;
  channelCount: number;
  /** Names resolved from guildIds at call time via client.guilds.cache */
  guildNames: string[];
  imageResults: StoredImageResult[];
  classificationResult: StoredClassificationResult | null;
  reviewId: string;
  resolved?: {
    statusLine: string;
    buttonLabel: string;
  };
}

export function buildScamCandidateReviewMessage(opts: ScamCandidateReviewViewOpts): {
  components: ContainerBuilder[];
  flags: number;
} {
  const {
    userId,
    username,
    channelCount,
    guildNames,
    imageResults,
    classificationResult,
    reviewId,
    resolved,
  } = opts;

  const newResults = imageResults.filter((r) => r.isNew);
  const nearResults = imageResults.filter((r) => !r.isNew);

  const textLines = [
    `-# Scam Candidate`,
    `**User:** ${username} (\`${userId}\`)`,
    `**Seen in:** ${channelCount} channels across ${guildNames.length} public servers within 2 min`,
    ...guildNames.map((name) => `- ${name}`),
  ];

  if (classificationResult) {
    const icon = classificationResult.isScam ? "🔴" : "🟢";
    const labelPart = classificationResult.suggestedLabel
      ? ` · \`${classificationResult.suggestedLabel}\``
      : "";
    const reason = classificationResult.reason.slice(0, MAX_REASON_DISPLAY_LENGTH);
    textLines.push(`-# AI: ${icon} ${classificationResult.confidence} confidence${labelPart} — ${reason}`);
  }

  if (nearResults.length > 0) {
    const nearNotes = nearResults
      .map(
        (r) =>
          `\`${r.filename}\` near-match #${r.closestId}${r.closestLabel ? ` ${r.closestLabel}` : ""} (dist ${r.closestDistance})`,
      )
      .join(", ");
    textLines.push(`-# Already known: ${nearNotes}`);
  }

  if (resolved) {
    textLines.push(resolved.statusLine);
  }

  const gallery = new MediaGalleryBuilder().addItems(
    ...imageResults.map((r) => new MediaGalleryItemBuilder().setURL(`attachment://${r.filename}`)),
  );

  const actionRow = resolved
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("scam_candidate:resolved")
          .setLabel(resolved.buttonLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      )
    : new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildIgnoreId(reviewId))
          .setLabel("Ignore")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildAddId(reviewId))
          .setLabel(newResults.length === 1 ? "Add 1 image" : `Add ${newResults.length} images`)
          .setStyle(ButtonStyle.Primary),
      );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(textLines.join("\n")))
    .addMediaGalleryComponents(gallery)
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(actionRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}
