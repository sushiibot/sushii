import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  Events,
  type MediaGalleryComponent,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Message,
} from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import {
  SCAM_HASH_DEDUP_THRESHOLD,
  SCAM_IMAGE_MAX_SIZE_BYTES,
  type ScamImageHashService,
} from "../../application/ScamImageHashService";
import type { ScamImageHashRepository } from "../../domain/repositories/ScamImageHashRepository";
import { isImageAttachment } from "../../utils/attachmentUtils";
import { formatDhash } from "../../utils/bigintUtils";

const OWNER_USER_ID = "150443906511667200";
const BUTTON_ADD_ALL = "scam_hash_dm:add_all";
const MODAL_LABEL = "scam_hash_dm:label";
const MODAL_LABEL_INPUT = "label";
const AWAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface CollectedImage {
  filename: string;
  url: string;
  source: "dm_attachment" | "snapshot_attachment" | "snapshot_component";
}

interface ImageCandidate {
  filename: string;
  url: string;
  hash: bigint;
  closestId: number | null;
  closestLabel: string | null;
  closestDistance: number | null;
}

export class ScamHashDMHandler extends EventHandler<Events.MessageCreate> {
  readonly eventType = Events.MessageCreate;
  readonly isExemptFromDeploymentCheck = true;

  constructor(
    private readonly repository: ScamImageHashRepository,
    private readonly hashService: ScamImageHashService,
    private readonly logger: Logger,
  ) {
    super();
  }

  // discord.js 14.26.2 regression: getChannel() now requires data.type === ChannelType.DM
  // to populate recipients, but Discord's gateway MESSAGE_CREATE payloads don't include
  // channel type. Without recipients, createChannel() returns null and the event is dropped.
  // Fix is in v15 dev but not backported to v14. Workaround: pre-fetch on ready so the
  // DMChannel is cached and getChannel() finds it directly without constructing it.
  // See: https://github.com/discordjs/discord.js/issues/11513
  async primeOwnerDMChannel(client: Client): Promise<void> {
    try {
      const user = await client.users.fetch(OWNER_USER_ID);
      await user.createDM();
      this.logger.debug({ userId: OWNER_USER_ID }, "Primed owner DM channel");
    } catch (err) {
      this.logger.warn({ err }, "Failed to prime owner DM channel");
    }
  }

  async handle(message: Message): Promise<void> {
    this.logger.debug(
      {
        channelType: message.channel.type,
        isDMBased: message.channel.isDMBased(),
        authorId: message.author.id,
        isOwner: message.author.id === OWNER_USER_ID,
      },
      "received MessageCreate",
    );

    if (!message.channel.isDMBased()) {
      this.logger.debug({ channelType: message.channel.type }, "skip — not DM");
      return;
    }

    if (message.author.id !== OWNER_USER_ID) {
      this.logger.debug({ authorId: message.author.id }, "skip — not owner");
      return;
    }

    // Collect image attachments from the DM itself and any forwarded message.
    // We check both snapshot.attachments and snapshot components (MediaGallery)
    // because CV2 messages may not include referenced files in the attachments
    // array — logging the source so we can confirm the actual behavior.
    const collected: CollectedImage[] = [];

    for (const a of message.attachments.values()) {
      if (
        isImageAttachment({ filename: a.name, contentType: a.contentType ?? undefined }) &&
        a.size <= SCAM_IMAGE_MAX_SIZE_BYTES
      ) {
        collected.push({ filename: a.name, url: a.proxyURL ?? a.url, source: "dm_attachment" });
      }
    }

    for (const snapshot of message.messageSnapshots.values()) {
      this.logger.debug(
        {
          snapshotAttachmentCount: snapshot.attachments.size,
          snapshotAttachments: [...snapshot.attachments.values()].map((a) => ({
            name: a.name,
            contentType: a.contentType,
            size: a.size,
            url: a.url,
            proxyURL: a.proxyURL,
          })),
          snapshotComponentCount: snapshot.components.length,
          snapshotComponents: snapshot.components.map((c) => ({
            type: c.type,
            // @ts-expect-error components may not exist on all types
            subComponentTypes: c.components?.map((sub: { type: number }) => sub.type) ?? [],
          })),
        },
        "Snapshot debug info",
      );

      // Source 1: snapshot.attachments (standard and non-CV2 messages)
      // Note: snapshot attachments may omit `size` (partial message object from Discord API),
      // so treat missing size as acceptable — download step does its own size validation.
      for (const a of snapshot.attachments.values()) {
        if (
          isImageAttachment({ filename: a.name, contentType: a.contentType ?? undefined }) &&
          (a.size == null || a.size <= SCAM_IMAGE_MAX_SIZE_BYTES)
        ) {
          collected.push({ filename: a.name, url: a.proxyURL ?? a.url, source: "snapshot_attachment" });
        }
      }

      // Source 2: MediaGallery items inside components (CV2 messages)
      for (const component of snapshot.components) {
        const galleries = component.type === ComponentType.MediaGallery
          ? [component as MediaGalleryComponent]
          : component.type === ComponentType.Container
            ? component.components.filter((c): c is MediaGalleryComponent => c.type === ComponentType.MediaGallery)
            : [];

        for (const gallery of galleries) {
          for (const item of gallery.items) {
            const url = item.media.data.proxy_url ?? item.media.url;
            this.logger.debug({ url }, "MediaGallery item URL");
            // Skip unresolved attachment:// references — no CDN URL available
            if (!url || url.startsWith("attachment://")) {
              continue;
            }
            if (isImageAttachment({ filename: url, contentType: undefined })) {
              const filename = url.split("/").pop() ?? "image";
              collected.push({ filename, url, source: "snapshot_component" });
            }
          }
        }
      }
    }

    this.logger.debug(
      { count: collected.length, sources: collected.map((c) => ({ filename: c.filename, source: c.source })) },
      "Collected images from DM for scam hash",
    );

    if (collected.length === 0) {
      await message.reply("No images found. Send a DM with an image attachment to add a scam hash.");
      return;
    }

    // Hash each image and check against DB
    const candidates: ImageCandidate[] = [];
    const errors: string[] = [];

    for (const attachment of collected) {
      try {
        const resp = await fetch(attachment.url, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!resp.ok) {
          errors.push(`${attachment.filename}: download failed (${resp.status})`);
          continue;
        }

        const buffer = Buffer.from(await resp.arrayBuffer());
        const hash = await this.hashService.computeHash(buffer);
        const closest = await this.repository.findClosest(hash);

        candidates.push({
          filename: attachment.filename,
          url: attachment.url,
          hash,
          closestId: closest?.entry.id ?? null,
          closestLabel: closest?.entry.label ?? null,
          closestDistance: closest?.distance ?? null,
        });
      } catch (err) {
        this.logger.warn({ err, filename: attachment.filename }, "Failed to hash DM attachment");
        errors.push(`${attachment.filename}: error processing`);
      }
    }

    if (candidates.length === 0) {
      await message.reply("Couldn't process any images.");
      return;
    }

    const dupes = candidates.filter(
      (c) => c.closestDistance !== null && c.closestDistance <= SCAM_HASH_DEDUP_THRESHOLD,
    );
    const toAdd = candidates.filter(
      (c) => c.closestDistance === null || c.closestDistance > SCAM_HASH_DEDUP_THRESHOLD,
    );

    // If everything is already a dupe, report and done
    if (toAdd.length === 0) {
      const lines = dupes.map(
        (c) =>
          `• \`${c.filename}\` — already exists as **#${c.closestId}**${c.closestLabel ? ` (${c.closestLabel})` : ""}, distance ${c.closestDistance}`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Scam Hash DM\n${lines.join("\n")}\nAll images already in database.`,
        ),
      );
      await message.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Build confirmation message
    const summaryLines: string[] = [];

    for (const c of toAdd) {
      const nearNote =
        c.closestDistance !== null
          ? ` *(near-match: #${c.closestId}${c.closestLabel ? ` ${c.closestLabel}` : ""}, distance ${c.closestDistance})*`
          : "";
      summaryLines.push(`• \`${c.filename}\` — **new**${nearNote}`);
    }
    for (const c of dupes) {
      summaryLines.push(
        `• \`${c.filename}\` — skip (exists as #${c.closestId}${c.closestLabel ? ` ${c.closestLabel}` : ""}, distance ${c.closestDistance})`,
      );
    }
    if (errors.length > 0) {
      for (const e of errors) {
        summaryLines.push(`• ${e}`);
      }
    }

    const addLabel = toAdd.length === 1 ? "Add 1 image" : `Add ${toAdd.length} images`;
    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Scam Hash DM\n${summaryLines.join("\n")}`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(BUTTON_ADD_ALL)
            .setLabel(addLabel)
            .setStyle(ButtonStyle.Primary),
        ),
      );

    const reply = await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    // Wait for the button
    let buttonInteraction;
    try {
      buttonInteraction = await reply.awaitMessageComponent({
        filter: (i) => i.user.id === OWNER_USER_ID && i.customId === BUTTON_ADD_ALL,
        time: AWAIT_TIMEOUT_MS,
      });
    } catch {
      // Timed out — disable the button
      const disabledContainer = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# Scam Hash DM\n${summaryLines.join("\n")}\n\n*Timed out.*`,
          ),
        );
      await reply.edit({
        components: [disabledContainer],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // Show modal for label
    const modal = new ModalBuilder()
      .setCustomId(MODAL_LABEL)
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

    await buttonInteraction.showModal(modal);

    // Wait for modal submit
    let modalInteraction;
    try {
      modalInteraction = await buttonInteraction.awaitModalSubmit({
        filter: (i) => i.customId === MODAL_LABEL,
        time: AWAIT_TIMEOUT_MS,
      });
    } catch {
      await reply.edit({
        components: [],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await modalInteraction.deferUpdate();

    const label = modalInteraction.fields.getTextInputValue(MODAL_LABEL_INPUT).trim() || undefined;

    // Add all non-dupe images
    const added: { id: number; filename: string; hash: bigint }[] = [];
    const addErrors: string[] = [];

    for (const c of toAdd) {
      try {
        const id = await this.repository.add(c.hash, label);
        added.push({ id, filename: c.filename, hash: c.hash });
      } catch (err) {
        this.logger.error({ err, filename: c.filename }, "Failed to add scam hash from DM");
        addErrors.push(c.filename);
      }
    }

    // Build result summary
    const resultLines: string[] = [];
    for (const a of added) {
      resultLines.push(
        `• **#${a.id}** \`${a.filename}\` \`${formatDhash(a.hash)}\`${label ? ` · ${label}` : ""}`,
      );
    }
    for (const c of dupes) {
      resultLines.push(
        `• Skipped \`${c.filename}\` — exists as #${c.closestId} (distance ${c.closestDistance})`,
      );
    }
    for (const f of addErrors) {
      resultLines.push(`• Failed to save \`${f}\``);
    }

    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Scam Hash DM\n${resultLines.join("\n")}\n\nAdded ${added.length}${dupes.length > 0 ? `, skipped ${dupes.length} duplicate(s)` : ""}.`,
      ),
    );

    await reply.edit({
      components: [resultContainer],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
