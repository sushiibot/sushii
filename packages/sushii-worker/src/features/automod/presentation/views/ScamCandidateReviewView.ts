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
  buildRevertId,
} from "../handlers/scamCandidateCustomIds";
import { formatDhash } from "../../utils/bigintUtils";
import type {
  StoredClassificationResult,
  StoredImageResult,
} from "../../domain/repositories/ScamCandidateRepository";


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
  /** When true, an active Revert button is shown alongside the resolved status */
  revertable?: boolean;
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
    revertable,
    resolved,
  } = opts;

  const newResults = imageResults.filter((r) => r.isNew);

  const userLines = [
    `-# Scam Candidate`,
    `**User**`,
    `${username} (\`${userId}\`)`,
    `**Seen in**`,
    `${channelCount} channels across ${guildNames.length} public servers within 2 min`,
    ...guildNames.map((name) => `- ${name}`),
  ];

  const imageLines = [`**Images**`];
  for (const r of imageResults) {
    const hashHex = formatDhash(BigInt(r.phash));
    let line = `• \`${hashHex}\``;
    if (r.closestId !== null) {
      const label = r.closestLabel ? ` "${r.closestLabel}"` : "";
      const prefix = r.isNew ? "nearest" : "≈";
      line += ` · ${prefix} #${r.closestId}${label} dist ${r.closestDistance}`;
    }
    imageLines.push(line);
  }

  const gallery =
    imageResults.length > 0
      ? new MediaGalleryBuilder().addItems(
          ...imageResults.map((r) => new MediaGalleryItemBuilder().setURL(`attachment://${r.filename}`)),
        )
      : null;

  const userCountButton =
    seenByUserCount > 1
      ? new ButtonBuilder()
          .setCustomId("scam_candidate:user_count")
          .setLabel(`${seenByUserCount} users`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      : null;

  const canRevert = resolved !== undefined && revertable === true;

  const actionRow = resolved
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...[
          new ButtonBuilder()
            .setCustomId("scam_candidate:resolved")
            .setLabel(resolved.buttonLabel)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          canRevert
            ? new ButtonBuilder()
                .setCustomId(buildRevertId(reviewId))
                .setLabel("Revert")
                .setStyle(ButtonStyle.Danger)
            : null,
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
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(userLines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(imageLines.join("\n")));

  if (gallery) {
    container.addMediaGalleryComponents(gallery);
  }

  if (classificationResult) {
    const icon = classificationResult.isScam ? "🔴" : "🟢";
    const labelPart = classificationResult.suggestedLabel
      ? ` · \`${classificationResult.suggestedLabel}\``
      : "";
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# AI: ${icon} ${classificationResult.confidence} confidence${labelPart} — ${classificationResult.reason}`,
        ),
      );
  }

  if (resolved) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(resolved.statusLine));
  }

  container.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(actionRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}
