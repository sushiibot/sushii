import sharp from "sharp";
import {
  DiscordAPIError,
  GuildFeature,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildTextBasedChannel,
  type MessageEditOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import { buildScamCandidateReviewMessage } from "../presentation/views/ScamCandidateReviewView";
import opentelemetry, { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Logger } from "pino";

import {
  SCAM_HASH_DEDUP_THRESHOLD,
  SCAM_IMAGE_MAX_DIMENSION,
  SCAM_IMAGE_MAX_SIZE_BYTES,
  type ScamImageHashService,
} from "./ScamImageHashService";
import type { ScamCandidateTrigger } from "../domain/repositories/ScamCandidateRepository";
import {
  MAX_LABEL_LENGTH,
  type ClassificationResult,
  type ScamImageClassifier,
} from "./ScamImageClassifier";
import type { ScamImageHashRepository } from "../domain/repositories/ScamImageHashRepository";
import type { ScamCandidateRepository, ScamCandidateState } from "../domain/repositories/ScamCandidateRepository";
import type { ScamImageStore } from "../infrastructure/ScamImageStore";
import type { ScamCandidateMetrics } from "../infrastructure/metrics/ScamCandidateMetrics";
import {
  buildModalId,
  SCAM_CANDIDATE_MODAL_LABEL_INPUT,
} from "../presentation/handlers/scamCandidateCustomIds";
import { buildHashKey } from "../utils/bigintUtils";
import { filenameFromUrl } from "../utils/imageUtils";

const tracer = opentelemetry.trace.getTracer("automod");

const REVIEW_CHANNEL_ID = "1083567458230739056";
const WINDOW_MS = 2 * 60 * 1000;
const CHANNEL_THRESHOLD = 5;
const CLAIMED_ORPHAN_TTL_MS = 15 * 60 * 1000;

// UnknownMessage is handled in editReviewMessage — it transitions state to 'ignored'.
// MissingPermissions/MissingAccess are swallowed silently since they reflect channel config.
const SWALLOWED_EDIT_CODES = new Set<number>([
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
]);

interface ImageResult {
  filename: string;
  buffer: Buffer;
  phash: bigint;
  closestId: number | null;
  closestLabel: string | null;
  closestDistance: number | null;
  isNew: boolean;
  s3Key: string | null;
}

export interface CandidateImage {
  fileSize: number;
  attachmentUrl: string;
}

export interface CandidateInput {
  userId: string;
  guildId: string;
  channelId: string;
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
    private readonly imageStore?: ScamImageStore,
  ) {}

  destroy(): void {
    // No-op: state is persisted in DB; periodic cleanup handled by janitor task
  }

  async track(input: CandidateInput): Promise<void> {
    const { userId, guildId, channelId, images } = input;

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
    const sightingKey = `${userId}:${sortedSizes}`;
    const attachmentUrls = images.map((i) => i.attachmentUrl);

    let thresholdResult;
    try {
      thresholdResult = await this.candidateRepository.recordSightingAndCheckThreshold(
        { key: sightingKey, guildId, channelId, attachmentUrls },
        WINDOW_MS,
        CHANNEL_THRESHOLD,
      );
    } catch (err) {
      this.logger.error({ err, userId, key: sightingKey }, "Failed to record scam candidate sighting");
      return;
    }

    if (!thresholdResult) {
      this.metrics.sightingCounter.add(1, { outcome: "recorded" });
      return;
    }

    this.metrics.sightingCounter.add(1, { outcome: "threshold_reached" });
    this.logger.debug(
      { userId, key: sightingKey, guildCount: thresholdResult.guildIds.length },
      "Scam candidate threshold reached, starting review",
    );

    this.processCandidate({
      userId,
      attachmentUrls: thresholdResult.attachmentUrls,
      channelCount: thresholdResult.channelCount,
      guildIds: new Set(thresholdResult.guildIds),
      trigger: "threshold",
    }).catch((err) => {
      this.logger.error({ err, userId }, "Scam candidate review failed");
    });
  }

  async triggerNearMissReview(input: {
    userId: string;
    guildId: string;
    attachmentUrls: string[];
  }): Promise<void> {
    const { userId, guildId, attachmentUrls } = input;

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.logger.trace({ guildId }, "near-miss skip — guild not in cache");
      return;
    }
    if (!guild.features.includes(GuildFeature.Discoverable)) {
      this.logger.trace({ guildId }, "near-miss skip — guild not discoverable");
      return;
    }

    this.processCandidate({
      userId,
      attachmentUrls,
      channelCount: 1,
      guildIds: new Set([guildId]),
      trigger: "near_miss",
    }).catch((err) => {
      this.logger.error({ err, userId }, "Near-miss candidate review failed");
    });
  }

  async handleIgnore(reviewId: string, interaction: ButtonInteraction): Promise<void> {
    await interaction.deferUpdate();

    const current = await this.candidateRepository.getByReviewId(reviewId);
    if (!current) {
      await interaction.followUp({
        content: "This review has expired — a new review will appear automatically.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (current.status === "claimed") {
      await interaction.followUp({
        content: "This review is still being set up — please try again in a moment.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (current.status === "ignored" || current.status === "added") {
      await interaction.followUp({
        content: "This review has already been resolved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const state = await this.candidateRepository.resolveReview(reviewId, "ignored");
    if (!state) {
      // Race: another moderator resolved it between check and resolveReview
      await interaction.followUp({
        content: "This review has already been resolved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.editReply(
      await this.buildReviewFromState(state, { statusLine: "*ignored*", buttonLabel: "Ignored" }),
    );
    this.metrics.reviewOutcomeCounter.add(1, { outcome: "ignored", trigger: state.trigger });
  }

  async handleAdd(reviewId: string, interaction: ButtonInteraction): Promise<void> {
    const state = await this.candidateRepository.getByReviewId(reviewId);
    if (!state) {
      await interaction.reply({
        content: "This review has expired — a new review will appear automatically.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (state.status === "claimed") {
      await interaction.reply({
        content: "This review is still being set up — please try again in a moment.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (state.status === "ignored" || state.status === "added") {
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

    const suggestedLabel = state.classificationResult?.suggestedLabel;
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
    const preState = await this.candidateRepository.getByReviewId(reviewId);
    if (!preState) {
      await interaction.reply({
        content: "This review has expired — a new review will appear automatically.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const label =
      interaction.fields.getTextInputValue(SCAM_CANDIDATE_MODAL_LABEL_INPUT).trim() || undefined;

    const imageResults = preState.newImageResults ?? [];
    const added: { id: number; filename: string }[] = [];
    const failed: string[] = [];

    for (const r of imageResults.filter((r) => r.isNew)) {
      try {
        const id = await this.hashRepository.add(BigInt(r.phash), label, r.s3Key ?? undefined);
        added.push({ id, filename: r.filename });
      } catch (err) {
        this.logger.error({ err, filename: r.filename }, "Failed to add scam hash from candidate review");
        failed.push(r.filename);
      }
    }

    if (added.length === 0) {
      await interaction.editReply(
        await this.buildReviewFromState(preState, { statusLine: "*failed to add hashes*", buttonLabel: "Failed" }),
      );
      this.metrics.reviewOutcomeCounter.add(1, { outcome: "add_failed", trigger: preState.trigger });
      return;
    }

    // Mark as added only after at least one hash insert succeeded — prevents the row
    // from being permanently "added" with zero hashes if all inserts fail.
    const state = await this.candidateRepository.resolveReview(reviewId, "added");
    if (!state) {
      // Race: another moderator resolved it between insert(s) and resolveReview
      await interaction.followUp({
        content: "This review has already been resolved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const failedSuffix = failed.length > 0 ? ` · ⚠ ${failed.length} failed` : "";
    const addedLabel = added.length === 1 ? "Added 1 image" : `Added ${added.length} images`;
    const statusSuffix = [
      `**${addedLabel}**${label ? ` · ${label}` : ""}${failedSuffix}`,
      ...added.map((a) => `• **#${a.id}** \`${a.filename}\``),
    ].join("\n");

    await interaction.editReply(
      await this.buildReviewFromState(state, { statusLine: statusSuffix, buttonLabel: addedLabel }),
    );

    this.metrics.reviewOutcomeCounter.add(1, { outcome: failed.length > 0 ? "add_failed" : "added", trigger: state.trigger });
  }

  /** Periodic janitor: delete sightings and orphaned claimed rows. */
  async deleteOldSightings(): Promise<void> {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const deleted = await this.candidateRepository.deleteOldSightings(cutoff);
    if (deleted > 0) {
      this.logger.debug({ deleted }, "Deleted old scam candidate sightings");
    }

    const claimedCutoff = new Date(Date.now() - CLAIMED_ORPHAN_TTL_MS);
    const deletedClaimed = await this.candidateRepository.deleteOrphanedClaimedRows(claimedCutoff);
    if (deletedClaimed > 0) {
      this.logger.debug({ deleted: deletedClaimed }, "Deleted orphaned claimed scam candidate rows");
    }
  }

  private async editReviewMessage(state: ScamCandidateState): Promise<void> {
    if (!state.reviewChannelId || !state.reviewMessageId) {
      return;
    }

    const options = await this.buildReviewFromState(state);

    try {
      const channel = await this.client.channels.fetch(state.reviewChannelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        return;
      }
      const msg = await (channel as GuildTextBasedChannel).messages.fetch(state.reviewMessageId);
      await msg.edit(options as MessageEditOptions);
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage) {
        await this.candidateRepository.resolveReview(state.reviewId, "ignored").catch((resolveErr) => {
          this.logger.error({ err: resolveErr, reviewId: state.reviewId }, "Failed to resolve review after UnknownMessage");
        });
        return;
      }
      if (err instanceof DiscordAPIError && SWALLOWED_EDIT_CODES.has(Number(err.code))) {
        return;
      }
      this.logger.warn({ err, reviewId: state.reviewId }, "Failed to edit review message");
    }
  }

  private async processCandidate(opts: {
    userId: string;
    attachmentUrls: string[];
    channelCount: number;
    guildIds: Set<string>;
    trigger: ScamCandidateTrigger;
  }): Promise<void> {
    const { userId, attachmentUrls, channelCount, guildIds, trigger } = opts;

    const results: ImageResult[] = [];

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

              const phash = await this.hashService.computePhash(buffer);
              const closest = await this.hashRepository.findClosest(phash);
              const isNew = !closest || closest.phashDistance > SCAM_HASH_DEDUP_THRESHOLD;
              const filename = `${idx}_${filenameFromUrl(url)}`;

              const s3Key = await this.imageStore?.store({
                buffer,
                phash,
                closestDistance: closest?.phashDistance,
                trigger: "candidate_review",
                userId,
                guildId: guildIds.values().next().value,
                filename,
              }) ?? null;

              return {
                filename,
                buffer,
                phash,
                closestId: closest?.entry.id ?? null,
                closestLabel: closest?.entry.label ?? null,
                closestDistance: closest?.phashDistance ?? null,
                isNew,
                s3Key,
              } satisfies ImageResult;
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

          if (results.length > 0 && results.every((r) => !r.isNew)) {
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
      this.metrics.reviewCounter.add(1, { outcome: "download_failed", trigger });
      return;
    }

    const newResults = results.filter((r) => r.isNew);

    if (newResults.length === 0) {
      this.logger.debug({ userId }, "All candidate images already in DB, skipping review");
      this.metrics.reviewCounter.add(1, { outcome: "all_known", trigger });
      return;
    }

    const hashes = results.map((r) => r.phash);
    const hashKey = buildHashKey(hashes);
    const guildIdsArray = [...guildIds];
    const reviewId = crypto.randomUUID();

    const claimed = await this.candidateRepository.claimByHashKey(
      hashKey,
      reviewId,
      userId,
      channelCount,
      guildIdsArray,
      trigger,
    );

    if (!claimed) {
      // Lost the claim race — append seen user and maybe update the review message
      const updated = await this.candidateRepository.appendSeenUser(
        hashKey,
        userId,
        channelCount,
        guildIdsArray,
      );

      if (updated?.status === "reviewing") {
        await this.editReviewMessage(updated);
      }

      this.metrics.reviewCounter.add(1, { outcome: "already_in_review", trigger });
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

    const fetchedChannel = this.client.channels.cache.get(REVIEW_CHANNEL_ID);
    if (!fetchedChannel?.isTextBased() || fetchedChannel.isDMBased()) {
      // Leave the row in 'claimed' — the orphan janitor will clean it up after
      // CLAIMED_ORPHAN_TTL_MS. Deleting here causes an infinite retry loop:
      // the sightings table still has old entries so the threshold fires again
      // immediately, re-claims, and re-fails.
      this.logger.error(
        { channelId: REVIEW_CHANNEL_ID },
        "Review channel not in cache — bot may be starting up, will retry via orphan janitor",
      );
      this.metrics.reviewCounter.add(1, { outcome: "channel_not_cached", trigger });
      return;
    }
    const reviewChannel = fetchedChannel as GuildTextBasedChannel;

    const guildNames = guildIdsArray.map((id) => this.client.guilds.cache.get(id)?.name ?? id);
    const username = await this.fetchUsername(userId);

    const imageResults = results.map((r) => ({
      filename: r.filename,
      phash: r.phash.toString(),
      closestId: r.closestId,
      closestLabel: r.closestLabel,
      closestDistance: r.closestDistance,
      isNew: r.isNew,
      s3Key: r.s3Key,
    }));

    const { components, flags } = buildScamCandidateReviewMessage({
      userId,
      username,
      channelCount,
      guildNames,
      imageResults,
      classificationResult,
      reviewId,
      seenByUserCount: 1,
    });

    const msg = await reviewChannel.send({
      components,
      flags,
      files: results.map((r) => ({ attachment: r.buffer, name: r.filename })),
    });

    const storedClassification = classificationResult
      ? {
          isScam: classificationResult.isScam,
          confidence: classificationResult.confidence,
          suggestedLabel: classificationResult.suggestedLabel,
          reason: classificationResult.reason,
        }
      : null;

    const reviewing = await this.candidateRepository.transitionToReviewing(hashKey, {
      reviewChannelId: REVIEW_CHANNEL_ID,
      reviewMessageId: msg.id,
      newImageResults: imageResults,
      classificationResult: storedClassification,
    });
    if (!reviewing) {
      const current = await this.candidateRepository.getByReviewId(reviewId);
      if (!current) {
        // Genuine orphan — state was deleted; clean up the Discord message
        this.logger.error(
          { reviewId, hashKey, messageId: msg.id },
          "Orphaned review message: state missing after send",
        );
        await msg.delete().catch((deleteErr) => {
          this.logger.warn({ err: deleteErr, messageId: msg.id }, "Failed to delete orphaned review message");
        });
      } else if (current.status === "ignored" || current.status === "added") {
        // Moderator resolved during send→transition window; message already updated
        this.logger.info(
          { reviewId, hashKey, status: current.status },
          "Review resolved by moderator during transition",
        );
      } else {
        // Unexpected: row exists in non-terminal state but transitionToReviewing failed
        this.logger.error(
          { reviewId, hashKey, status: current.status, messageId: msg.id },
          "transitionToReviewing returned null for non-terminal row — leaving message",
        );
      }
      this.metrics.reviewCounter.add(1, { outcome: "state_lost", trigger });
      return;
    }

    if (reviewing.seenByUserIds.length > 1) {
      await this.editReviewMessage(reviewing);
    }

    this.metrics.reviewCounter.add(1, { outcome: "review_sent", trigger });
  }

  private async buildReviewFromState(
    state: ScamCandidateState,
    resolved?: { statusLine: string; buttonLabel: string },
  ): Promise<ReturnType<typeof buildScamCandidateReviewMessage>> {
    const guildNames = state.guildIds.map((id) => this.client.guilds.cache.get(id)?.name ?? id);
    const username = await this.fetchUsername(state.triggeredByUserId);
    return buildScamCandidateReviewMessage({
      userId: state.triggeredByUserId,
      username,
      channelCount: state.channelCount,
      guildNames,
      imageResults: state.newImageResults ?? [],
      classificationResult: state.classificationResult,
      reviewId: state.reviewId,
      seenByUserCount: state.seenByUserIds.length,
      resolved,
    });
  }

  private async fetchUsername(userId: string): Promise<string> {
    const cached = this.client.users.cache.get(userId)?.username;
    if (cached) {
      return cached;
    }
    try {
      const user = await this.client.users.fetch(userId);
      return user.username;
    } catch {
      this.logger.debug({ userId }, "Failed to fetch username, falling back to user ID");
      return userId;
    }
  }
}
