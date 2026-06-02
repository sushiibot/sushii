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
const BUTTON_AWAIT_MS = 30 * 60 * 1000; // 30 minutes to review

const MAX_REASON_DISPLAY_LENGTH = 200;

const SWALLOWED_EDIT_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
]);

interface Sighting {
  channelId: string;
  guildId: string;
  timestamp: number;
  messageUrl: string;
  attachmentUrls: string[];
}

interface CandidateEntry {
  sightings: Sighting[];
  nextNotifyChannelThreshold: number;
  reviewing: boolean;
  ignored: boolean;
}

interface ImageResult {
  filename: string;
  buffer: Buffer;
  hash: bigint;
  closestId: number | null;
  closestLabel: string | null;
  closestDistance: number | null;
  isNew: boolean;
}

interface PendingReview {
  userId: string;
  username: string;
  jumpUrl: string;
  entry: CandidateEntry;
  newResults: ImageResult[];
  classificationResult: ClassificationResult | null;
  msg: Message;
  cleanupTimer: ReturnType<typeof setTimeout>;
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
  // key: `${userId}:${sortedFileSizes}`
  private readonly candidates = new Map<string, CandidateEntry>();
  private readonly pendingReviews = new Map<string, PendingReview>();
  private readonly janitorInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly client: Client,
    private readonly hashService: ScamImageHashService,
    private readonly repository: ScamImageHashRepository,
    private readonly metrics: ScamCandidateMetrics,
    private readonly logger: Logger,
    private readonly classifier?: ScamImageClassifier,
  ) {
    this.janitorInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.candidates) {
        if (entry.reviewing) {
          continue;
        }
        const hasRecentSightings = entry.sightings.some((s) => now - s.timestamp <= WINDOW_MS);
        if (!hasRecentSightings) {
          this.candidates.delete(key);
        }
      }
    }, 5 * 60 * 1000);
    // Prevent the interval from keeping the process alive
    this.janitorInterval.unref();
  }

  destroy(): void {
    clearInterval(this.janitorInterval);
    for (const [, review] of this.pendingReviews) {
      clearTimeout(review.cleanupTimer);
    }
    this.pendingReviews.clear();
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

    this.logger.debug({ guildId, channelId, userId, imageCount: images.length }, "Scam candidate sighting recorded");

    const sortedSizes = images
      .map((i) => i.fileSize)
      .sort((a, b) => a - b)
      .join(",");
    const key = `${userId}:${sortedSizes}`;
    const now = Date.now();
    const messageUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

    let entry = this.candidates.get(key);
    if (!entry) {
      entry = {
        sightings: [],
        nextNotifyChannelThreshold: CHANNEL_THRESHOLD,
        reviewing: false,
        ignored: false,
      };
      this.candidates.set(key, entry);
    }

    entry.sightings.push({
      channelId,
      guildId,
      timestamp: now,
      messageUrl,
      attachmentUrls: images.map((i) => i.attachmentUrl),
    });
    entry.sightings = entry.sightings.filter((s) => now - s.timestamp <= WINDOW_MS);

    if (entry.reviewing || entry.ignored) {
      return;
    }

    const distinctChannels = new Set(entry.sightings.map((s) => s.channelId));
    const distinctGuilds = new Set(entry.sightings.map((s) => s.guildId));

    if (
      distinctChannels.size < entry.nextNotifyChannelThreshold ||
      distinctGuilds.size < GUILD_THRESHOLD
    ) {
      this.metrics.sightingCounter.add(1, { outcome: "recorded" });
      return;
    }

    this.metrics.sightingCounter.add(1, { outcome: "threshold_reached" });
    entry.reviewing = true;

    const sample = entry.sightings[entry.sightings.length - 1];

    this.sendReview({
      userId,
      username,
      attachmentUrls: sample.attachmentUrls,
      jumpUrl: sample.messageUrl,
      channelCount: distinctChannels.size,
      guildCount: distinctGuilds.size,
      entry,
    }).catch((err) => {
      entry.reviewing = false;
      this.logger.error({ err, userId, key }, "Scam candidate review failed");
    });
  }

  async handleIgnore(reviewId: string, interaction: ButtonInteraction): Promise<void> {
    const review = this.pendingReviews.get(reviewId);
    if (!review) {
      await interaction.reply({ content: "This review has already been resolved.", flags: MessageFlags.Ephemeral });
      return;
    }
    review.entry.ignored = true;
    await interaction.update(this.reviewStatusMessage(review, "*ignored*"));
    this.metrics.reviewOutcomeCounter.add(1, { outcome: "ignored" });
    this.cleanupReview(reviewId);
  }

  async handleAdd(reviewId: string, interaction: ButtonInteraction): Promise<void> {
    const review = this.pendingReviews.get(reviewId);
    if (!review) {
      await interaction.reply({ content: "This review has already been resolved.", flags: MessageFlags.Ephemeral });
      return;
    }

    const labelInput = new TextInputBuilder()
      .setCustomId(SCAM_CANDIDATE_MODAL_LABEL_INPUT)
      .setLabel("Label (optional)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("e.g. tezowin.com promo");

    if (review.classificationResult?.suggestedLabel) {
      labelInput.setValue(review.classificationResult.suggestedLabel.slice(0, MAX_LABEL_LENGTH));
    }

    const modal = new ModalBuilder()
      .setCustomId(buildModalId(reviewId))
      .setTitle("Scam Hash Label")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput));

    await interaction.showModal(modal);
  }

  async handleLabelModal(reviewId: string, interaction: ModalSubmitInteraction): Promise<void> {
    const review = this.pendingReviews.get(reviewId);
    if (!review) {
      await interaction.reply({ content: "This review has already been resolved.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();

    const label =
      interaction.fields.getTextInputValue(SCAM_CANDIDATE_MODAL_LABEL_INPUT).trim() || undefined;

    const added: { id: number; filename: string }[] = [];
    const failed: string[] = [];
    for (const r of review.newResults) {
      try {
        const id = await this.repository.add(r.hash, label);
        added.push({ id, filename: r.filename });
      } catch (err) {
        this.logger.error({ err, filename: r.filename }, "Failed to add scam hash from candidate review");
        failed.push(r.filename);
      }
    }

    if (added.length === 0) {
      await this.safeEditMessage(review.msg, this.reviewStatusMessage(review, "*failed to add hashes*"));
      this.metrics.reviewOutcomeCounter.add(1, { outcome: "add_failed" });
      this.cleanupReview(reviewId);
      return;
    }

    const addedLines = added.map((a) => `**#${a.id}** \`${a.filename}\``).join(", ");
    const failedSuffix = failed.length > 0 ? ` · ⚠ ${failed.length} failed` : "";
    await this.safeEditMessage(
      review.msg,
      this.reviewStatusMessage(review, `added ${addedLines}${label ? ` · ${label}` : ""}${failedSuffix}`),
    );

    this.metrics.reviewOutcomeCounter.add(1, { outcome: failed.length > 0 ? "add_failed" : "added" });
    this.cleanupReview(reviewId);
  }

  private cleanupReview(reviewId: string): void {
    const review = this.pendingReviews.get(reviewId);
    if (review) {
      clearTimeout(review.cleanupTimer);
      review.entry.reviewing = false;
      this.pendingReviews.delete(reviewId);
    }
  }

  private reviewStatusMessage(review: PendingReview, suffix: string): MessageEditOptions {
    return {
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# Scam Candidate\n**User:** ${review.username} (\`${review.userId}\`) · [Jump](${review.jumpUrl}) — ${suffix}`,
          ),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
      attachments: [],
    };
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
    userId: string;
    username: string;
    attachmentUrls: string[];
    jumpUrl: string;
    channelCount: number;
    guildCount: number;
    entry: CandidateEntry;
  }): Promise<void> {
    const { userId, username, attachmentUrls, jumpUrl, channelCount, guildCount, entry } = opts;

    let results: ImageResult[] = [];
    let newResults: ImageResult[] = [];

    // Download, hash, and DB-check all images in the set in parallel
    await tracer.startActiveSpan(
      "automod.candidate.process",
      { kind: SpanKind.INTERNAL, attributes: { "user.id": userId, "candidate.images.count": attachmentUrls.length } },
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

              // Dimension guard matching ScamImageHashService.downloadImage
              const meta = await sharp(buffer).metadata();
              if (
                (meta.width && meta.width > SCAM_IMAGE_MAX_DIMENSION) ||
                (meta.height && meta.height > SCAM_IMAGE_MAX_DIMENSION)
              ) {
                this.logger.debug({ url }, "Skipping oversized candidate image dimensions");
                throw new Error("oversized dimensions");
              }

              const hash = await this.hashService.computeHash(buffer);
              const closest = await this.repository.findClosest(hash);
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
      return;
    }

    // Skip if entire set is already known — double threshold so we don't re-hash on every sighting
    if (newResults.length === 0) {
      this.logger.debug({ userId }, "All candidate images already in DB, skipping review");
      entry.nextNotifyChannelThreshold *= 2;
      entry.reviewing = false;
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
            { isScam: classificationResult.isScam, confidence: classificationResult.confidence, label: classificationResult.suggestedLabel },
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

    const textLines = [
      `-# Scam Candidate`,
      `**User:** ${username} (\`${userId}\`)`,
      `**Seen in:** ${channelCount} channels across ${guildCount} public servers within 2 min`,
      `[Jump to message](${jumpUrl})`,
    ];
    if (classificationResult) {
      const icon = classificationResult.isScam ? "🔴" : "🟢";
      const labelPart = classificationResult.suggestedLabel ? ` · \`${classificationResult.suggestedLabel}\`` : "";
      const reason = classificationResult.reason.slice(0, MAX_REASON_DISPLAY_LENGTH);
      textLines.push(`-# AI: ${icon} ${classificationResult.confidence} confidence${labelPart} — ${reason}`);
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
    entry.nextNotifyChannelThreshold *= 2;
    this.metrics.reviewCounter.add(1, { outcome: "sent" });

    const cleanupTimer = setTimeout(async () => {
      const review = this.pendingReviews.get(reviewId);
      if (review) {
        await this.safeEditMessage(review.msg, this.reviewStatusMessage(review, "*timed out*"));
        this.metrics.reviewOutcomeCounter.add(1, { outcome: "timed_out" });
        this.cleanupReview(reviewId);
      }
    }, BUTTON_AWAIT_MS);

    this.pendingReviews.set(reviewId, {
      userId,
      username,
      jumpUrl,
      entry,
      newResults,
      classificationResult,
      msg,
      cleanupTimer,
    });
  }
}
