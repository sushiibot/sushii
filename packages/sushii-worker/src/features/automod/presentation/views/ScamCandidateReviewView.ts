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
import { formatDhash } from "../../utils/bigintUtils";
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
  seenByUserCount: number;
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
    seenByUserCount,
    resolved,
  } = opts;

  const newResults = imageResults.filter((r) => r.isNew);

  const textLines = [
    `-# Scam Candidate`,
    `**User**`,
    `${username} (\`${userId}\`)`,
    `**Seen in**`,
    `${channelCount} channels across ${guildNames.length} public servers within 2 min`,
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

  textLines.push("**Images**");
  for (const r of imageResults) {
    const hashHex = formatDhash(BigInt(r.phash));
    let line = `• \`${hashHex}\``;
    if (r.closestId !== null) {
      const label = r.closestLabel ? ` "${r.closestLabel}"` : "";
      const prefix = r.isNew ? "nearest" : "≈";
      line += ` · ${prefix} #${r.closestId}${label} dist ${r.closestDistance}`;
    }
    textLines.push(line);
  }

  if (resolved) {
    textLines.push(resolved.statusLine);
  }

  const gallery = new MediaGalleryBuilder().addItems(
    ...imageResults.map((r) => new MediaGalleryItemBuilder().setURL(`attachment://${r.filename}`)),
  );

  const userCountButton =
    seenByUserCount > 1
      ? new ButtonBuilder()
          .setCustomId("scam_candidate:user_count")
          .setLabel(`${seenByUserCount} users`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      : null;

  const actionRow = resolved
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...[
          new ButtonBuilder()
            .setCustomId("scam_candidate:resolved")
            .setLabel(resolved.buttonLabel)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          userCountButton,
        ].filter((b): b is ButtonBuilder => b !== null),
      )
    : new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...[
          new ButtonBuilder()
            .setCustomId(buildIgnoreId(reviewId))
            .setLabel("Ignore")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(buildAddId(reviewId))
            .setLabel(newResults.length === 1 ? "Add 1 image" : `Add ${newResults.length} images`)
            .setStyle(ButtonStyle.Primary),
          userCountButton,
        ].filter((b): b is ButtonBuilder => b !== null),
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
