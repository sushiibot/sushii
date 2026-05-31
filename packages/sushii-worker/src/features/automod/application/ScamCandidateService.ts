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
  type Client,
  type GuildTextBasedChannel,
  type Message,
  type MessageComponentInteraction,
  type MessageEditOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import type { Logger } from "pino";

import {
  SCAM_HASH_DEDUP_THRESHOLD,
  SCAM_IMAGE_MAX_DIMENSION,
  SCAM_IMAGE_MAX_SIZE_BYTES,
  type ScamImageHashService,
} from "./ScamImageHashService";
import type { ScamImageHashRepository } from "../domain/repositories/ScamImageHashRepository";

const REVIEW_CHANNEL_ID = "1083567458230739056";
const WINDOW_MS = 2 * 60 * 1000;
const CHANNEL_THRESHOLD = 5;
const GUILD_THRESHOLD = 2;
const BUTTON_AWAIT_MS = 30 * 60 * 1000; // 30 minutes to review
const MODAL_AWAIT_MS = 5 * 60 * 1000; // 5 minutes to submit the modal

const BUTTON_IGNORE = "scam_candidate:ignore";
const BUTTON_ADD = "scam_candidate:add";
const MODAL_LABEL_ID = "scam_candidate:label";
const MODAL_LABEL_INPUT = "label";

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
  private readonly janitorInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly client: Client,
    private readonly hashService: ScamImageHashService,
    private readonly repository: ScamImageHashRepository,
    private readonly logger: Logger,
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
  }

  async track(input: CandidateInput): Promise<void> {
    const { userId, username, guildId, channelId, messageId, images } = input;

    if (images.length === 0) {
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.logger.debug({ guildId }, "skip — guild not in cache");
      return;
    }
    if (!guild.features.includes(GuildFeature.Discoverable)) {
      this.logger.debug({ guildId }, "skip — guild not discoverable");
      return;
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      this.logger.debug({ guildId, channelId }, "skip — channel not in cache");
      return;
    }

    const everyonePerms = channel.permissionsFor(guild.roles.everyone);
    if (!everyonePerms?.has(PermissionFlagsBits.ViewChannel)) {
      this.logger.debug({ guildId, channelId }, "skip — channel not public");
      return;
    }

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
      return;
    }

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
    })
      .catch((err) => {
        this.logger.error({ err, userId, key }, "Scam candidate review failed");
      })
      .finally(() => {
        entry.reviewing = false;
      });
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

    const statusContainer = (suffix: string): MessageEditOptions => ({
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# Scam Candidate\n**User:** ${username} (\`${userId}\`) · [Jump](${jumpUrl}) — ${suffix}`,
          ),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
      attachments: [],
    });

    // Download and hash all images in the set in parallel
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
          closestLabel: closest?.entry.label ?? closest?.entry.category ?? null,
          closestDistance: closest?.distance ?? null,
          isNew,
        };
        return result;
      }),
    );

    const results: ImageResult[] = [];
    for (const r of settled) {
      if (r.status === "rejected") {
        this.logger.warn({ reason: r.reason }, "Failed to process candidate image");
      } else {
        results.push(r.value);
      }
    }

    if (results.length === 0) {
      return;
    }

    const newResults = results.filter((r) => r.isNew);

    // Skip if entire set is already known — double threshold so we don't re-hash on every sighting
    if (newResults.length === 0) {
      this.logger.debug({ userId }, "All candidate images already in DB, skipping review");
      entry.nextNotifyChannelThreshold *= 2;
      return;
    }

    const fetchedChannel = await this.client.channels.fetch(REVIEW_CHANNEL_ID);
    if (!fetchedChannel?.isTextBased() || fetchedChannel.isDMBased()) {
      this.logger.error(
        { channelId: REVIEW_CHANNEL_ID },
        "Review channel not found or not text-based",
      );
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

    const textLines = [
      `-# Scam Candidate`,
      `**User:** ${username} (\`${userId}\`)`,
      `**Seen in:** ${channelCount} channels across ${guildCount} public servers within 2 min`,
      `[Jump to message](${jumpUrl})`,
    ];
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
            .setCustomId(BUTTON_IGNORE)
            .setLabel("Ignore")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(BUTTON_ADD)
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

    let interaction: MessageComponentInteraction | undefined;
    try {
      interaction = await msg.awaitMessageComponent({
        filter: (i) => i.customId === BUTTON_IGNORE || i.customId === BUTTON_ADD,
        time: BUTTON_AWAIT_MS,
      });
    } catch {
      await this.safeEditMessage(msg, statusContainer("*timed out*"));
      return;
    }

    if (interaction.customId === BUTTON_IGNORE) {
      entry.ignored = true;
      await interaction.update(statusContainer("*ignored*"));
      return;
    }

    // Add flow
    const modal = new ModalBuilder()
      .setCustomId(MODAL_LABEL_ID)
      .setTitle("Scam Hash Label")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(MODAL_LABEL_INPUT)
            .setLabel("Label (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("e.g. tezowin.com promo"),
        ),
      );

    await interaction.showModal(modal);

    let modalInteraction: ModalSubmitInteraction | undefined;
    try {
      modalInteraction = await interaction.awaitModalSubmit({
        filter: (i) => i.customId === MODAL_LABEL_ID,
        time: MODAL_AWAIT_MS,
      });
    } catch {
      return;
    }

    await modalInteraction.deferUpdate();

    const label = modalInteraction.fields.getTextInputValue(MODAL_LABEL_INPUT).trim() || undefined;

    const added: { id: number; filename: string }[] = [];
    const failed: string[] = [];
    for (const r of newResults) {
      try {
        const id = await this.repository.add(r.hash, undefined, label);
        added.push({ id, filename: r.filename });
      } catch (err) {
        this.logger.error(
          { err, filename: r.filename },
          "Failed to add scam hash from candidate review",
        );
        failed.push(r.filename);
      }
    }

    if (added.length === 0) {
      await this.safeEditMessage(msg, statusContainer("*failed to add hashes*"));
      return;
    }

    const addedLines = added.map((a) => `**#${a.id}** \`${a.filename}\``).join(", ");
    const failedSuffix = failed.length > 0 ? ` · ⚠ ${failed.length} failed` : "";
    await this.safeEditMessage(
      msg,
      statusContainer(`added ${addedLines}${label ? ` · ${label}` : ""}${failedSuffix}`),
    );
  }
}
