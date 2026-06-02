import sharp from "sharp";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  DiscordAPIError,
  GuildFeature,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildTextBasedChannel,
  type Message,
  type MessageEditOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import opentelemetry, { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Logger } from "pino";

import {
  SCAM_HASH_DEDUP_THRESHOLD,
  SCAM_IMAGE_MAX_DIMENSION,
  SCAM_IMAGE_MAX_SIZE_BYTES,
  type ScamImageHashService,
} from "./ScamImageHashService";
import {
  MAX_LABEL_LENGTH,
  type ClassificationResult,
  type ScamImageClassifier,
} from "./ScamImageClassifier";
import type { ScamImageHashRepository } from "../domain/repositories/ScamImageHashRepository";
import type { ScamCandidateRepository } from "../domain/repositories/ScamCandidateRepository";
import type { ScamCandidateMetrics } from "../infrastructure/metrics/ScamCandidateMetrics";
import {
  buildAddId,
  buildIgnoreId,
  buildModalId,
  SCAM_CANDIDATE_MODAL_LABEL_INPUT,
} from "../presentation/handlers/scamCandidateCustomIds";

const tracer = opentelemetry.trace.getTracer("automod");

const REVIEW_CHANNEL_ID = "1083567458230739056";
const WINDOW_MS = 2 * 60 * 1000;
const CHANNEL_THRESHOLD = 5;
const GUILD_THRESHOLD = 2;

const MAX_REASON_DISPLAY_LENGTH = 200;

const SWALLOWED_EDIT_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
]);

interface ImageResult {
  filename: string;
  buffer: Buffer;
  hash: bigint;
  closestId: number | null;
  closestLabel: string | null;
  closestDistance: number | null;
  isNew: boolean;
}

export interface CandidateImage {
  fileSize: number;
  attachmentUrl: string;
}

export interface CandidateInput {
  userId: string;
  username: string;
  guildId: string;
  channelId: string;
  messageId: string;
  images: CandidateImage[];
}

export class ScamCandidateService {
  constructor(
    private readonly client: Client,
    private readonly hashService: ScamImageHashService,
    private readonly hashRepository: ScamImageHashRepository,
    private readonly candidateRepository: ScamCandidateRepository,
    private readonly metrics: ScamCandidateMetrics,
    private readonly logger: Logger,
    private readonly classifier?: ScamImageClassifier,
  ) {}

  destroy(): void {
    // No-op: state is persisted in DB; periodic cleanup handled by janitor task
  }

  async track(input: CandidateInput): Promise<void> {
    const { userId, username, guildId, channelId, messageId, images } = input;

    if (images.length === 0) {
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.logger.trace({ guildId }, "skip — guild not in cache");
      return;
    }
    if (!guild.features.includes(GuildFeature.Discoverable)) {
      this.logger.trace({ guildId }, "skip — guild not discoverable");
      return;
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      this.logger.trace({ guildId, channelId }, "skip — channel not in cache");
      return;
    }

    const everyonePerms = channel.permissionsFor(guild.roles.everyone);
    if (!everyonePerms?.has(PermissionFlagsBits.ViewChannel)) {
      this.logger.trace({ guildId, channelId }, "skip — channel not public");
      return;
    }

    this.logger.debug(
      { guildId, channelId, userId, imageCount: images.length },
      "Scam candidate sighting recorded",
    );

    const sortedSizes = images
      .map((i) => i.fileSize)
      .sort((a, b) => a - b)
      .join(",");
    const key = `${userId}:${sortedSizes}`;
    const attachmentUrls = images.map((i) => i.attachmentUrl);
    const messageUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

    let claimed;
    try {
      claimed = await this.candidateRepository.trackAndMaybeClaim(
        { key, guildId, channelId, attachmentUrls },
        WINDOW_MS,
        GUILD_THRESHOLD,
      );
    } catch (err) {
      this.logger.error({ err, userId, key }, "Failed to track scam candidate sighting");
      return;
    }

    if (!claimed) {
      this.metrics.sightingCounter.add(1, { outcome: "recorded" });
      return;
    }

    this.metrics.sightingCounter.add(1, { outcome: "threshold_reached" });
    this.logger.debug({ userId, key, guildCount: claimed.guildIds.length }, "Scam candidate threshold reached, starting review");

    this.sendReview({
      key,
      userId,
      username,
      attachmentUrls: claimed.attachmentUrls,
      channelCount: claimed.channelCount,
      guildIds: new Set(claimed.guildIds),
      messageUrl,
    }).catch((err) => {
      this.logger.error({ err, userId, key }, "Scam candidate review failed");
      this.candidateRepository.releaseReview(key).catch((releaseErr) => {
        this.logger.error({ err: releaseErr, key }, "Failed to release review after error");
      });
    });
  }

  async handleIgnore(reviewId: string, interaction: ButtonInteraction): Promise<void> {
    const resolved = await this.candidateRepository.resolveReview(reviewId, { ignored: true });
    if (!resolved) {
      await interaction.reply({
        content: "This review has already been resolved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update(this.resolvedStatusMessage(interaction.message, "*ignored*"));
    this.metrics.reviewOutcomeCounter.add(1, { outcome: "ignored" });
  }

  async handleAdd(reviewId: string, interaction: ButtonInteraction): Promise<void> {
    const review = await this.candidateRepository.getReview(reviewId);
    if (!review) {
      await interaction.reply({
        content: "This review has already been resolved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const labelInput = new TextInputBuilder()
      .setCustomId(SCAM_CANDIDATE_MODAL_LABEL_INPUT)
      .setLabel("Label (optional)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("e.g. tezowin.com promo");

    const suggestedLabel = review.classificationResult?.suggestedLabel;
    if (suggestedLabel) {
      labelInput.setValue(suggestedLabel.slice(0, MAX_LABEL_LENGTH));
    }

    const modal = new ModalBuilder()
      .setCustomId(buildModalId(reviewId))
      .setTitle("Scam Hash Label")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput));

    await interaction.showModal(modal);
  }

  async handleLabelModal(reviewId: string, interaction: ModalSubmitInteraction): Promise<void> {
    const review = await this.candidateRepository.getReview(reviewId);
    if (!review) {
      await interaction.reply({
        content: "This review has already been resolved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const label =
      interaction.fields.getTextInputValue(SCAM_CANDIDATE_MODAL_LABEL_INPUT).trim() || undefined;

    const added: { id: number; filename: string }[] = [];
    const failed: string[] = [];

    for (const r of review.newImageResults) {
      try {
        const hash = BigInt(r.hash);
        const id = await this.hashRepository.add(hash, label);
        added.push({ id, filename: r.filename });
      } catch (err) {
        this.logger.error({ err, filename: r.filename }, "Failed to add scam hash from candidate review");
        failed.push(r.filename);
      }
    }

    const msg = await this.fetchReviewMessage(review.reviewChannelId, review.reviewMessageId);

    if (added.length === 0) {
      if (msg) {
        await this.safeEditMessage(msg, this.storedReviewStatusMessage(review, "*failed to add hashes*"));
      }
      this.metrics.reviewOutcomeCounter.add(1, { outcome: "add_failed" });
      await this.candidateRepository.resolveReview(reviewId);
      return;
    }

    const addedLines = added.map((a) => `**#${a.id}** \`${a.filename}\``).join(", ");
    const failedSuffix = failed.length > 0 ? ` · ⚠ ${failed.length} failed` : "";
    const statusSuffix = `added ${addedLines}${label ? ` · ${label}` : ""}${failedSuffix}`;

    if (msg) {
      await this.safeEditMessage(msg, this.storedReviewStatusMessage(review, statusSuffix));
    }

    this.metrics.reviewOutcomeCounter.add(1, { outcome: failed.length > 0 ? "add_failed" : "added" });
    await this.candidateRepository.resolveReview(reviewId);
  }

  /** Periodic janitor: delete sightings outside the tracking window. */
  async deleteOldSightings(): Promise<void> {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const deleted = await this.candidateRepository.deleteOldSightings(cutoff);
    if (deleted > 0) {
      this.logger.debug({ deleted }, "Deleted old scam candidate sightings");
    }
  }

  private resolvedStatusMessage(originalMessage: Message, suffix: string): MessageEditOptions {
    return {
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# Scam Candidate\n${suffix}`,
          ),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
      attachments: [],
    };
  }

  private storedReviewStatusMessage(
    review: { userId: string; username: string },
    suffix: string,
  ): MessageEditOptions {
    return {
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# Scam Candidate\n**User:** ${review.username} (\`${review.userId}\`) — ${suffix}`,
          ),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
      attachments: [],
    };
  }

  private async fetchReviewMessage(
    channelId: string,
    messageId: string,
  ): Promise<Message | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        return null;
      }
      return await (channel as GuildTextBasedChannel).messages.fetch(messageId);
    } catch (err) {
      this.logger.warn({ err, channelId, messageId }, "Failed to fetch review message");
      return null;
    }
  }

  private async safeEditMessage(msg: Message, options: MessageEditOptions): Promise<void> {
    try {
      await msg.edit(options);
    } catch (err) {
      if (err instanceof DiscordAPIError && SWALLOWED_EDIT_CODES.has(Number(err.code))) {
        return;
      }
      throw err;
    }
  }

  private async sendReview(opts: {
    key: string;
    userId: string;
    username: string;
    attachmentUrls: string[];
    channelCount: number;
    guildIds: Set<string>;
    messageUrl: string;
  }): Promise<void> {
    const { key, userId, username, attachmentUrls, channelCount, guildIds } = opts;

    let results: ImageResult[] = [];
    let newResults: ImageResult[] = [];

    await tracer.startActiveSpan(
      "automod.candidate.process",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "user.id": userId, "candidate.images.count": attachmentUrls.length },
      },
      async (span) => {
        try {
          const settled = await Promise.allSettled(
            attachmentUrls.map(async (url, idx) => {
              const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
              if (!resp.ok) {
                this.logger.warn({ url, status: resp.status }, "Failed to download candidate image");
                throw new Error(`HTTP ${resp.status}`);
              }

              const contentLength = resp.headers.get("content-length");
              const cl = Number(contentLength);
              if (Number.isFinite(cl) && cl > SCAM_IMAGE_MAX_SIZE_BYTES) {
                this.logger.debug({ url }, "Skipping oversized candidate image (content-length)");
                throw new Error("oversized content-length");
              }

              const buffer = Buffer.from(await resp.arrayBuffer());

              if (buffer.byteLength > SCAM_IMAGE_MAX_SIZE_BYTES) {
                this.logger.debug({ url }, "Skipping oversized candidate image (buffer)");
                throw new Error("oversized buffer");
              }

              const meta = await sharp(buffer).metadata();
              if (
                (meta.width && meta.width > SCAM_IMAGE_MAX_DIMENSION) ||
                (meta.height && meta.height > SCAM_IMAGE_MAX_DIMENSION)
              ) {
                this.logger.debug({ url }, "Skipping oversized candidate image dimensions");
                throw new Error("oversized dimensions");
              }

              const hash = await this.hashService.computeHash(buffer);
              const closest = await this.hashRepository.findClosest(hash);
              const isNew = !closest || closest.distance > SCAM_HASH_DEDUP_THRESHOLD;
              const rawFilename = url.split("?")[0].split("/").pop() || "candidate.png";
              const filename = `${idx}_${rawFilename}`;

              const result: ImageResult = {
                filename,
                buffer,
                hash,
                closestId: closest?.entry.id ?? null,
                closestLabel: closest?.entry.label ?? null,
                closestDistance: closest?.distance ?? null,
                isNew,
              };
              return result;
            }),
          );

          for (const r of settled) {
            if (r.status === "rejected") {
              this.logger.warn({ reason: r.reason }, "Failed to process candidate image");
            } else {
              results.push(r.value);
            }
          }

          span.setAttribute("candidate.images.processed", results.length);
          span.setAttribute("candidate.images.new", results.filter((r) => r.isNew).length);
          span.setAttribute("candidate.images.failed", attachmentUrls.length - results.length);

          if (results.length === 0) {
            span.addEvent("all_downloads_failed");
          }

          newResults = results.filter((r) => r.isNew);
          if (results.length > 0 && newResults.length === 0) {
            span.addEvent("all_images_known");
          }
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );

    if (results.length === 0) {
      this.metrics.reviewCounter.add(1, { outcome: "download_failed" });
      await this.candidateRepository.releaseReview(key);
      return;
    }

    if (newResults.length === 0) {
      this.logger.debug({ userId }, "All candidate images already in DB, skipping review");
      await this.candidateRepository.updateStateAfterReview(key, { releaseReviewing: true });
      this.metrics.reviewCounter.add(1, { outcome: "all_known" });
      return;
    }

    // Classify new images with AI (best-effort, non-blocking on failure)
    let classificationResult: ClassificationResult | null = null;
    if (this.classifier) {
      const classifySpan = tracer.startSpan("automod.candidate.classify", {
        kind: SpanKind.INTERNAL,
        attributes: { "user.id": userId, "candidate.images.new": newResults.length },
      });
      try {
        classificationResult = await this.classifier.classify(
          newResults.map((r) => ({ buffer: r.buffer, filename: r.filename })),
        );
        if (classificationResult) {
          classifySpan.setAttributes({
            "classification.is_scam": classificationResult.isScam,
            "classification.confidence": classificationResult.confidence,
            "classification.has_suggested_label": classificationResult.suggestedLabel !== null,
          });
          this.logger.debug(
            {
              isScam: classificationResult.isScam,
              confidence: classificationResult.confidence,
              label: classificationResult.suggestedLabel,
            },
            "Scam candidate classified",
          );
        } else {
          classifySpan.addEvent("classification_failed", { reason: "classify returned null" });
        }
      } finally {
        classifySpan.end();
      }
    }

    const fetchedChannel = await this.client.channels.fetch(REVIEW_CHANNEL_ID);
    if (!fetchedChannel?.isTextBased() || fetchedChannel.isDMBased()) {
      this.logger.error(
        { channelId: REVIEW_CHANNEL_ID },
        "Review channel not found or not text-based",
      );
      this.metrics.reviewCounter.add(1, { outcome: "channel_error" });
      await this.candidateRepository.releaseReview(key);
      return;
    }
    const reviewChannel = fetchedChannel as GuildTextBasedChannel;

    const newCount = newResults.length;
    const nearNotes = results
      .filter((r) => !r.isNew)
      .map(
        (r) =>
          `\`${r.filename}\` near-match #${r.closestId}${r.closestLabel ? ` ${r.closestLabel}` : ""} (dist ${r.closestDistance})`,
      )
      .join(", ");

    const addLabel = newCount === 1 ? "Add 1 image" : `Add ${newCount} images`;

    const reviewId = crypto.randomUUID();

    const guildNames = [...guildIds].map((id) => {
      const name = this.client.guilds.cache.get(id)?.name;
      return `- ${name ?? id}`;
    });

    const textLines = [
      `-# Scam Candidate`,
      `**User:** ${username} (\`${userId}\`)`,
      `**Seen in:** ${channelCount} channels across ${guildIds.size} public servers within 2 min`,
      ...guildNames,
    ];
    if (classificationResult) {
      const icon = classificationResult.isScam ? "🔴" : "🟢";
      const labelPart = classificationResult.suggestedLabel
        ? ` · \`${classificationResult.suggestedLabel}\``
        : "";
      const reason = classificationResult.reason.slice(0, MAX_REASON_DISPLAY_LENGTH);
      textLines.push(
        `-# AI: ${icon} ${classificationResult.confidence} confidence${labelPart} — ${reason}`,
      );
    }
    if (nearNotes) {
      textLines.push(`-# Already known: ${nearNotes}`);
    }

    const gallery = new MediaGalleryBuilder().addItems(
      ...results.map((r) => new MediaGalleryItemBuilder().setURL(`attachment://${r.filename}`)),
    );

    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(textLines.join("\n")))
      .addMediaGalleryComponents(gallery)
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(buildIgnoreId(reviewId))
            .setLabel("Ignore")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(buildAddId(reviewId))
            .setLabel(addLabel)
            .setStyle(ButtonStyle.Primary),
        ),
      );

    const msg = await reviewChannel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      files: results.map((r) => ({ attachment: r.buffer, name: r.filename })),
    });

    await this.candidateRepository.saveReview({
      reviewId,
      key,
      userId,
      username,
      reviewChannelId: REVIEW_CHANNEL_ID,
      reviewMessageId: msg.id,
      newImageResults: newResults.map((r) => ({
        filename: r.filename,
        hash: r.hash.toString(),
        closestId: r.closestId,
        closestLabel: r.closestLabel,
        closestDistance: r.closestDistance,
      })),
      classificationResult: classificationResult
        ? {
            isScam: classificationResult.isScam,
            confidence: classificationResult.confidence,
            suggestedLabel: classificationResult.suggestedLabel,
            reason: classificationResult.reason,
          }
        : null,
    });

    await this.candidateRepository.updateStateAfterReview(key, { releaseReviewing: false });

    this.metrics.reviewCounter.add(1, { outcome: "sent" });
  }
}
