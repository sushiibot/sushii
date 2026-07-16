import type { APIContainerComponent, APIMessage } from "discord-api-types/v10";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
  type ButtonInteraction,
  type Client,
} from "discord.js";
import type { Logger } from "pino";

import Color from "@/utils/colors";

import { REVIEW_CHANNEL_ID } from "../constants";
import type { ScamHashReportRepository } from "../domain/repositories/ScamHashReportRepository";
import type { ScamImageHashRepository } from "../domain/repositories/ScamImageHashRepository";
import type { ScamImageStore } from "../infrastructure/ScamImageStore";
import { stripActionRowAndAppendLine } from "../utils/alertComponentUtils";
import {
  buildReportDismissId,
  buildReportRevertId,
} from "../presentation/handlers/automodAlertExtraCustomIds";

export interface SubmitReportOpts {
  hashId: number;
  reporterId: string;
  guildId: string;
  guildName: string;
}

export type SubmitReportResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

export class ScamHashReportService {
  constructor(
    private readonly client: Client,
    private readonly reportRepository: ScamHashReportRepository,
    private readonly hashRepository: ScamImageHashRepository,
    private readonly imageStore: ScamImageStore | undefined,
    private readonly logger: Logger,
  ) {}

  /**
   * Only writes a row — never touches the review channel directly. sushii runs
   * multiple shards/clusters and the reporting guild may not be co-located with
   * the cluster that owns the home guild's review channel, so posting happens
   * out-of-band via postPendingReports() on whichever cluster does own it.
   */
  async submitReport(opts: SubmitReportOpts): Promise<SubmitReportResult> {
    const { hashId, reporterId, guildId, guildName } = opts;

    const hash = await this.hashRepository.findById(hashId);
    if (!hash) {
      return { ok: false, reason: "not_found" };
    }

    // Guards against a double-click submitting two rows before the alert
    // button is disabled — not airtight under true concurrency, but the two
    // report clicks a real double-click produces are far enough apart in
    // practice that this closes the window.
    const existing = await this.reportRepository.findActive(hashId, reporterId);
    if (existing) {
      return { ok: true };
    }

    await this.reportRepository.create({ hashId, reporterId, guildId, guildName });

    return { ok: true };
  }

  /**
   * Posts every pending row's review message on the owning cluster.
   * Failures are returned, not swallowed here — the caller (the polling
   * task, an infrastructure boundary) decides how to surface them.
   */
  async postPendingReports(): Promise<{ reportId: number; error: unknown }[]> {
    const pendingRows = await this.reportRepository.getPendingRows();

    const results = await Promise.allSettled(
      pendingRows.map((row) =>
        this.postPendingReport(row.id, row.hashId, row.reporterId, row.guildId, row.guildName),
      ),
    );

    return results.flatMap((result, i) =>
      result.status === "rejected"
        ? [{ reportId: pendingRows[i].id, error: result.reason }]
        : [],
    );
  }

  private async postPendingReport(
    reportId: number,
    hashId: number,
    reporterId: string,
    guildId: string,
    guildName: string,
  ): Promise<void> {
    const reviewChannel = this.client.channels.cache.get(REVIEW_CHANNEL_ID);
    if (!reviewChannel || !reviewChannel.isTextBased() || reviewChannel.isDMBased()) {
      return;
    }

    const hash = await this.hashRepository.findById(hashId);

    const lines = [
      `-# Reported as incorrect`,
      `**Hash** ${hash ? `#${hash.id}${hash.label ? ` · \`${hash.label}\`` : ""}` : `#${hashId} (already removed)`}`,
      `**Reported by** <@${reporterId}> in ${guildName} (\`${guildId}\`)`,
    ];

    const container = new ContainerBuilder()
      .setAccentColor(Color.Warning)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));

    const files: AttachmentBuilder[] = [];
    if (hash?.s3Key) {
      const buffer = await this.imageStore?.download(hash.s3Key);
      if (buffer) {
        const filename = `hash-${hash.id}.png`;
        files.push(new AttachmentBuilder(buffer, { name: filename }));
        container
          .addSeparatorComponents(new SeparatorBuilder())
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
              new MediaGalleryItemBuilder().setURL(`attachment://${filename}`),
            ),
          );
      }
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildReportRevertId(reportId))
        .setLabel("Revert Hash")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hash),
      new ButtonBuilder()
        .setCustomId(buildReportDismissId(reportId))
        .setLabel("Dismiss")
        .setStyle(ButtonStyle.Secondary),
    );
    container.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(actionRow);

    const message = await reviewChannel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
      files,
    });

    await this.reportRepository.markPosted(reportId, message.id);

    this.logger.info({ reportId, hashId, reporterId, guildId }, "Posted scam hash report for review");
  }

  async handleRevert(reportId: number, interaction: ButtonInteraction): Promise<void> {
    // Atomically claim the row (posted -> reverted) before touching the hash —
    // if a concurrent Dismiss click already resolved it, this returns false
    // and we must not delete the hash out from under that resolution.
    const claimed = await this.reportRepository.resolve(reportId, "reverted");
    if (!claimed) {
      await interaction.reply({
        content: "This report was already resolved by someone else.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const report = await this.reportRepository.findById(reportId);
    let hashRemoved = false;
    if (report) {
      try {
        hashRemoved = await this.hashRepository.delete(report.hashId);
      } catch (err) {
        // Keep the row retryable instead of stuck "reverted" with the hash
        // still live — the mod's next click can pick up where this left off.
        await this.reportRepository.revertToPosted(reportId);
        throw err;
      }
    }

    const statusLine = hashRemoved
      ? `Reverted by ${interaction.user.toString()} — hash removed`
      : `Reverted by ${interaction.user.toString()} — hash was already removed`;
    await this.resolveReviewMessage(interaction, statusLine);

    this.logger.info(
      { reportId, hashId: report?.hashId, executorId: interaction.user.id },
      "Reported scam hash reverted",
    );
  }

  async handleDismiss(reportId: number, interaction: ButtonInteraction): Promise<void> {
    const claimed = await this.reportRepository.resolve(reportId, "dismissed");
    if (!claimed) {
      await interaction.reply({
        content: "This report was already resolved by someone else.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.resolveReviewMessage(interaction, `Dismissed by ${interaction.user.toString()} — hash kept`);

    this.logger.info({ reportId, executorId: interaction.user.id }, "Scam hash report dismissed");
  }

  private async resolveReviewMessage(
    interaction: ButtonInteraction,
    statusLine: string,
  ): Promise<void> {
    const rawMessage = interaction.message.toJSON() as APIMessage;
    const rawContainer = (rawMessage.components ?? [])[0] as
      | APIContainerComponent
      | undefined;
    if (!rawContainer) {
      await interaction.deferUpdate();
      return;
    }

    const updatedContainer = stripActionRowAndAppendLine(
      rawContainer,
      new TextDisplayBuilder().setContent(statusLine).toJSON(),
    );

    await interaction.update({
      components: [updatedContainer],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }
}
