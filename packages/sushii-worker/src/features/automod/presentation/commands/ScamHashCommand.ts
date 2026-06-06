import type { ChatInputCommandInteraction } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ScamImageHashRepository } from "../../domain/repositories/ScamImageHashRepository";
import {
  SCAM_IMAGE_MAX_SIZE_BYTES,
  SCAM_IMAGE_MAX_DIMENSION,
  SCAM_HASH_DEDUP_THRESHOLD,
  type ScamImageHashService,
} from "../../application/ScamImageHashService";
import { isImageAttachment } from "../../utils/attachmentUtils";
import { formatDhash } from "../../utils/bigintUtils";

const LIST_PAGE_SIZE = 25;

export class ScamHashCommand extends SlashCommandHandler {
  // 418504865543749642 — sushii home guild; scam hash management is bot-admin-only
  readonly registeredGuilds = ["418504865543749642"] as const;

  readonly command = new SlashCommandBuilder()
    .setName("scam-hash")
    .setDescription("Manage known scam image hashes")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a known scam image hash")
        .addAttachmentOption((opt) =>
          opt
            .setName("image")
            .setDescription("The scam image to hash")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("label").setDescription("Descriptive label for this hash"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a scam image hash by ID")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("The hash entry ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List stored scam image hashes"),
    )
    .toJSON();

  constructor(
    private readonly repository: ScamImageHashRepository,
    private readonly hashService: ScamImageHashService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand(true);

    switch (sub) {
      case "add":
        await this.handleAdd(interaction);
        break;
      case "delete":
        await this.handleDelete(interaction);
        break;
      case "list":
        await this.handleList(interaction);
        break;
      default:
        this.logger.warn({ sub }, "Unknown subcommand");
        break;
    }
  }

  private async handleAdd(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const attachment = interaction.options.getAttachment("image", true);
    const label = interaction.options.getString("label") ?? undefined;

    if (
      !isImageAttachment({
        filename: attachment.name,
        contentType: attachment.contentType ?? undefined,
      })
    ) {
      await interaction.editReply("Attachment must be an image file.");
      return;
    }

    if (attachment.size > SCAM_IMAGE_MAX_SIZE_BYTES) {
      await interaction.editReply("Image must be 5MB or smaller.");
      return;
    }

    if (
      (attachment.width && attachment.width > SCAM_IMAGE_MAX_DIMENSION) ||
      (attachment.height && attachment.height > SCAM_IMAGE_MAX_DIMENSION)
    ) {
      await interaction.editReply(
        `Image dimensions must not exceed ${SCAM_IMAGE_MAX_DIMENSION}px on either side.`,
      );
      return;
    }

    const response = await fetch(attachment.url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await interaction.editReply("Failed to download the attachment.");
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const { hash, phash } = await this.hashService.computeHashes(buffer);

    const closest = await this.repository.findClosest(hash, phash);
    if (closest && closest.distance <= SCAM_HASH_DEDUP_THRESHOLD) {
      const dupeLabel = closest.entry.label ?? "unlabeled";
      await interaction.editReply(
        `A near-duplicate already exists: ID **${closest.entry.id}** (${dupeLabel}, distance ${closest.distance}). Use \`/scam-hash list\` to review.`,
      );
      return;
    }

    const id = await this.repository.add(hash, phash, label);
    const hexHash = formatDhash(hash);

    await interaction.editReply(
      `Stored scam hash **#${id}** — \`${hexHash}\`${label ? ` · ${label}` : ""}`,
    );
  }

  private async handleDelete(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getInteger("id", true);
    const deleted = await this.repository.delete(id);

    if (deleted) {
      await interaction.editReply(`Deleted entry ID **${id}**.`);
    } else {
      await interaction.editReply(`No entry found with ID **${id}**.`);
    }
  }

  private async handleList(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const entries = await this.repository.list();

    if (entries.length === 0) {
      await interaction.editReply("No scam hashes stored yet.");
      return;
    }

    const page = entries.slice(0, LIST_PAGE_SIZE);
    const rows = page.map((e) => {
      const hexHash = formatDhash(e.hash);
      const date = e.addedAt.toISOString().slice(0, 10);
      const labelText = e.label ?? "—";
      return `**#${e.id}** \`${hexHash}\` · ${labelText} · ${date}`;
    });

    const content = rows.join("\n");

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );

    if (entries.length > LIST_PAGE_SIZE) {
      container
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# Showing ${LIST_PAGE_SIZE} of ${entries.length} entries`,
          ),
        );
    }

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
