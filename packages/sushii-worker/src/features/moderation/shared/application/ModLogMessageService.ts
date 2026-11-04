import type {
  ButtonInteraction,
  Client,
  Message,
  ModalMessageModalSubmitInteraction,
  SendableChannels,
  User,
} from "discord.js";
import { AttachmentBuilder, Routes } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { getCleanFilename } from "@/utils/url";

import type { CaseProof, NewCaseProof } from "../domain/entities/CaseProof";
import type { ModerationCase } from "../domain/entities/ModerationCase";
import type { ModerationMetrics } from "../domain/metrics/ModerationMetrics";
import { NOOP_MODERATION_METRICS } from "../domain/metrics/ModerationMetrics";
import type { CaseProofRepository } from "../domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "../domain/repositories/ModLogRepository";
import { isGalleryMedia } from "../presentation/caseMedia";
import {
  proofEntryText,
  proofFileLinks,
} from "../presentation/proof/proofBlock";
import {
  MESSAGE_TEXT_MAX_LENGTH,
  MOD_LOG_EMOJIS,
  type ModLogMessage,
  type ModLogMessageInput,
  type ModLogProof,
  type ModLogTarget,
  buildLegacyConversionBody,
  buildModLogMessage,
  extractFactsBlock,
  extractLegacyFacts,
  galleryItemCount,
  hasLiveDm,
  isLegacyEntry,
  isLegacyEntryWithDeletedDm,
  messageTextLength,
} from "../presentation/views/ModLogMessageView";
import {
  buildProofReplyMessage,
  proofReplyParts,
} from "../presentation/views/ModLogProofReplyView";
import { guildDmText } from "./DMNotificationService";
import {
  type ProofUpload,
  postedFiles,
  postedFilesOf,
  uniqueUploadNames,
  uploadedUrls,
} from "./proofHosting";

export type { ProofUpload } from "./proofHosting";

/**
 * - `hosted`: files went on the entry or an overflow reply to it
 * - `text_only`: no files; hostMessageId is where the text shows, null when there's no entry yet
 * - `no_mod_log`: files given but there's no entry or channel to hold them
 */
export type ProofHostResult =
  | { kind: "hosted"; hostMessageId: string; attachmentUrls: string[] }
  | { kind: "text_only"; hostMessageId: string | null }
  | { kind: "no_mod_log" };

/** A proof as the entry places it: a stored row, or a draft the caller inserts afterwards. */
type PlacedProof = ModLogProof & Pick<CaseProof, "hostMessageId">;

const MESSAGE_FILES_MAX = 10;
// Headroom an entry keeps so the later "More proof" link and the Delete DM prompt still fit.
// The link line with 20-digit ids and its newline is 126; the prompt is 92 plus a
// markdown-escaped name of up to 37 characters (legacy tags), so at most 166.
export const MORE_PROOF_LINE_RESERVE = 130;
export const DELETE_DM_PROMPT_RESERVE = 170;
// A signed CDN link to an uploaded file, shown once its URL is known.
const FILE_LINK_RESERVE = 300;
const PROOF_DOWNLOAD_TIMEOUT_MS = 15_000;
const PROOF_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type ModLogRenderOptions = Pick<
  ModLogMessageInput,
  "timeoutChange" | "confirmDeleteDm"
> & {
  /** Skips the user fetch when the caller already has the target. */
  targetUser?: User;
  /** The posted entry being replaced, so facts the row can't rebuild are kept. */
  currentMessage?: Message | null;
};

interface PlaceResult {
  hostMessageId: string;
  attachmentUrls: string[];
  /** The entry after the edit, when it was edited. */
  entry: Message;
}

/**
 * - `updated`: the mod log message was edited
 * - `pending`: no message yet; the audit log post will render the current row
 * - `no_message`: the case was never posted (mod log was off at the time)
 * - `not_configured`: the guild has no mod log channel now
 * - `failed`: the channel or message couldn't be fetched or edited
 */
export type ModLogRefreshOutcome =
  | "updated"
  | "pending"
  | "no_message"
  | "not_configured"
  | "failed";

/** A case with its posted mod log message, or why there's none. */
export interface ModLogEntry {
  /** Synced with what a legacy entry shows (see syncLegacyDeletedDm). */
  moderationCase: ModerationCase;
  message: Message | null;
  /** Set when message is null. */
  missing: Exclude<ModLogRefreshOutcome, "updated"> | null;
}

type MessageInteraction =
  | ButtonInteraction<"cached">
  | ModalMessageModalSubmitInteraction<"cached">;

interface DownloadedProof {
  files: ProofUpload[];
  /** URLs that couldn't be downloaded, kept so the row still points at them. */
  failed: string[];
}

/**
 * Files hosted nowhere on the mod log yet. Backfilled rows are skipped: their
 * links are old slash-command uploads that Discord has already deleted.
 */
function isAdoptable(proof: CaseProof): boolean {
  return (
    proof.hostMessageId === null &&
    proof.source !== "backfill" &&
    proof.attachments.some(Boolean)
  );
}

/** Upper bound of the text a proof adds to the entry, file links included. */
function proofTextLength(proof: ModLogProof): number {
  const links = proofFileLinks([proof]).filter(
    (url) => !url.startsWith("attachment://"),
  );
  return (
    proofEntryText(proof, PROOF_TEXT_EMOJIS).length +
    1 +
    links.reduce((sum, url) => sum + url.length + 1, 0)
  );
}

// proofEntryText doesn't use emojis; only lengths are measured here.
const PROOF_TEXT_EMOJIS = { lock: "", attachment: "" };

function toAttachment(file: ProofUpload, name: string): AttachmentBuilder {
  return new AttachmentBuilder(file.data, { name });
}

function defaultAvatarURL(userId: string): string {
  let index = 0n;
  try {
    index = (BigInt(userId) >> 22n) % 6n;
  } catch {
    // Non-numeric IDs only appear in tests and fixtures; the first default avatar is fine.
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Renders mod log entries from a case and keeps posted entries in sync with
 * the database row. Every edit goes through here so legacy embed entries are
 * converted the same way.
 */
export class ModLogMessageService {
  constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly modLogRepository: Pick<ModLogRepository, "markDmDeleted">,
    private readonly caseProofRepository: CaseProofRepository,
    private readonly logger: Logger,
    private readonly metrics: Pick<
      ModerationMetrics,
      "recordModLogEdit"
    > = NOOP_MODERATION_METRICS,
  ) {}

  async render(
    moderationCase: ModerationCase,
    options: ModLogRenderOptions = {},
  ): Promise<ModLogMessage> {
    const proofs = await this.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    );
    return this.renderWithProofs(moderationCase, options, proofs);
  }

  private async renderWithProofs(
    moderationCase: ModerationCase,
    options: ModLogRenderOptions,
    proofs: readonly PlacedProof[],
    entryId: string | null = moderationCase.msgId,
  ): Promise<ModLogMessage> {
    return (await this.planEntry(moderationCase, options, proofs, entryId))
      .message;
  }

  /** Renders the entry, plus the unhosted proof that didn't fit on it. */
  private async planEntry<P extends PlacedProof>(
    moderationCase: ModerationCase,
    options: ModLogRenderOptions,
    proofs: readonly P[],
    entryId: string | null,
  ): Promise<{ message: ModLogMessage; omitted: P[]; textLength: number }> {
    const { targetUser, currentMessage, ...viewOptions } = options;
    const executorId = moderationCase.executorId ?? this.client.user?.id;

    const [target, executorTag, emojis, config] = await Promise.all([
      this.resolveTarget(moderationCase, targetUser),
      executorId ? this.resolveTag(executorId) : Promise.resolve(null),
      this.emojiRepository.getEmojis(MOD_LOG_EMOJIS),
      this.guildConfigRepository.findByGuildId(moderationCase.guildId),
    ]);

    let factsBlock: string | null = null;
    let extraFacts: string[] = [];
    if (currentMessage) {
      const json = currentMessage.toJSON() as Parameters<
        typeof extractFactsBlock
      >[0];
      if (isLegacyEntry(currentMessage)) {
        extraFacts = extractLegacyFacts(json, moderationCase);
      } else {
        factsBlock = extractFactsBlock(json);
      }
    }

    const overflowHost = proofs.find(
      (p) => p.hostMessageId !== null && p.hostMessageId !== entryId,
    )?.hostMessageId;
    const channelId =
      currentMessage?.channelId ?? config.loggingSettings.modLogChannel;
    const moreProofUrl =
      overflowHost && channelId
        ? `https://discord.com/channels/${moderationCase.guildId}/${channelId}/${overflowHost}`
        : null;

    const build = (shown: readonly PlacedProof[]) =>
      buildModLogMessage({
        moderationCase,
        target,
        emojis,
        fallbackExecutorId: this.client.user?.id ?? null,
        executorTag,
        factsBlock,
        extraFacts,
        proofs: shown,
        moreProofUrl,
        dmIncludedServerText:
          hasLiveDm(moderationCase) &&
          !!guildDmText(moderationCase.actionType, config),
        ...viewOptions,
      });

    // Proof hosted on the entry always fits; unhosted proof is shown while it
    // fits and otherwise waits for adoption to move it into a reply.
    const shown = new Set(
      proofs.filter((p) => entryId !== null && p.hostMessageId === entryId),
    );
    let length = messageTextLength(build([...shown]));
    for (const proof of proofs.filter((p) => p.hostMessageId === null)) {
      const added = proofTextLength(proof);
      if (length + added <= MESSAGE_TEXT_MAX_LENGTH) {
        shown.add(proof);
        length += added;
      }
    }

    const ordered = proofs.filter((p) => shown.has(p));
    return {
      message: build(ordered),
      omitted: proofs.filter((p) => p.hostMessageId === null && !shown.has(p)),
      textLength: length,
    };
  }

  /**
   * Embed entries from before components v2 marked a deleted DM only on the
   * message. Stores it, so neither a re-render nor a DM edit treats the DM
   * as live.
   */
  async syncLegacyDeletedDm(
    moderationCase: ModerationCase,
    message: Message | null,
  ): Promise<ModerationCase> {
    if (
      moderationCase.dmDeleted ||
      !message ||
      !isLegacyEntryWithDeletedDm(message)
    ) {
      return moderationCase;
    }

    await this.modLogRepository.markDmDeleted(
      moderationCase.guildId,
      moderationCase.caseId,
      null,
      null,
    );
    return moderationCase.withDmDeleted();
  }

  /** Fetches the case's posted entry and syncs a legacy DM deletion. */
  async loadEntry(moderationCase: ModerationCase): Promise<ModLogEntry> {
    if (!moderationCase.msgId) {
      return {
        moderationCase,
        message: null,
        missing: moderationCase.pending ? "pending" : "no_message",
      };
    }

    const config = await this.guildConfigRepository.findByGuildId(
      moderationCase.guildId,
    );
    const channelId = config.loggingSettings.modLogChannel;
    if (!channelId || !config.loggingSettings.modLogEnabled) {
      return { moderationCase, message: null, missing: "not_configured" };
    }

    let message: Message;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        this.logger.warn(
          { guildId: moderationCase.guildId, channelId },
          "Mod log channel is missing or not text-based",
        );
        return { moderationCase, message: null, missing: "failed" };
      }
      message = await channel.messages.fetch(moderationCase.msgId);
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          channelId,
          messageId: moderationCase.msgId,
        },
        "Failed to fetch mod log message",
      );
      return { moderationCase, message: null, missing: "failed" };
    }

    return {
      moderationCase: await this.syncLegacyDeletedDm(moderationCase, message),
      message,
      missing: null,
    };
  }

  /**
   * Re-renders a loaded entry. Pass the entry's case or a newer copy of it.
   * Proof files not hosted anywhere yet are moved onto the entry first.
   * Best effort: failures are logged and returned, never thrown.
   */
  async refreshEntry(
    entry: Pick<ModLogEntry, "message" | "missing">,
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<ModLogRefreshOutcome> {
    // A deleted or inaccessible entry isn't an edit failure.
    if (!entry.message) {
      return entry.missing ?? "no_message";
    }

    const original = entry.message;
    const stored = await this.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    );
    const { proofs, message } = await this.adoptUnhosted(
      original,
      moderationCase,
      stored,
    );
    const kind = isLegacyEntry(message) ? "legacy_conversion" : "v2";
    const rendered = await this.renderWithProofs(
      moderationCase,
      { ...options, currentMessage: original },
      proofs,
      message.id,
    );

    try {
      if (kind === "legacy_conversion") {
        await this.convertLegacyEntry(
          message.channelId,
          message.id,
          message.flags.bitfield,
          rendered,
        );
      } else {
        await message.edit(rendered);
      }
      this.metrics.recordModLogEdit(kind, "ok");
      return "updated";
    } catch (err) {
      this.metrics.recordModLogEdit(kind, "failed");
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          messageId: message.id,
        },
        "Failed to update mod log message",
      );
      return "failed";
    }
  }

  /** loadEntry then refreshEntry. Best effort, never throws for Discord failures. */
  async refresh(
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<ModLogRefreshOutcome> {
    const entry = await this.loadEntry(moderationCase);
    return this.refreshEntry(entry, entry.moderationCase, options);
  }

  /**
   * Puts a new proof entry on the case's mod log entry, or in a reply to it
   * when the entry is full. The caller stores the row with the result.
   * Throws when Discord rejects the edit or reply.
   */
  async hostProof(
    moderationCase: ModerationCase,
    draft: NewCaseProof,
    files: ProofUpload[],
  ): Promise<ProofHostResult> {
    const entry = await this.loadEntry(moderationCase);
    if (!entry.message) {
      return files.length > 0
        ? { kind: "no_mod_log" }
        : { kind: "text_only", hostMessageId: null };
    }

    const stored = await this.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    );
    // Files already waiting go first, so the entry's files are all real attachments.
    const adopted = await this.adoptUnhosted(
      entry.message,
      entry.moderationCase,
      stored,
    );
    const placed = await this.placeProof(
      adopted.message,
      entry.moderationCase,
      adopted.proofs,
      { ...draft, createdAt: draft.createdAt ?? new Date() },
      files,
    );

    return files.length > 0
      ? {
          kind: "hosted",
          hostMessageId: placed.hostMessageId,
          attachmentUrls: placed.attachmentUrls,
        }
      : { kind: "text_only", hostMessageId: placed.hostMessageId };
  }

  /**
   * Posts a new entry. Proof files not hosted anywhere yet go up with it when
   * they fit, since a refresh may never run for this case.
   */
  async postEntry(
    channel: SendableChannels,
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<Message> {
    const proofs = await this.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    );

    const uploads: { proof: CaseProof; download: DownloadedProof }[] = [];
    let fileCount = 0;
    for (const proof of proofs.filter(isAdoptable)) {
      const download = await this.downloadProofFiles(proof);
      const count = download.files.length;
      if (count === 0 || fileCount + count > MESSAGE_FILES_MAX) {
        continue;
      }
      uploads.push({ proof, download });
      fileCount += count;
    }

    const names = uniqueUploadNames(
      uploads.flatMap((u) => u.download.files),
      [],
    );
    const namesOf = new Map<string, string[]>();
    let offset = 0;
    for (const { proof, download } of uploads) {
      namesOf.set(
        proof.id,
        names.slice(offset, offset + download.files.length),
      );
      offset += download.files.length;
    }

    const pending = (urlsOf: (proof: CaseProof) => string[]) =>
      proofs.map((proof) =>
        namesOf.has(proof.id)
          ? { ...proof, attachments: urlsOf(proof) }
          : proof,
      );
    const withRefs = pending((proof) => [
      ...(namesOf.get(proof.id) ?? []).map((n) => `attachment://${n}`),
      ...(uploads.find((u) => u.proof.id === proof.id)?.download.failed ?? []),
    ]);

    const plan = await this.planEntry(moderationCase, options, withRefs, null);
    const uploadIds = new Set(uploads.map((u) => u.proof.id));
    const carriesUploads =
      uploads.length > 0 &&
      !plan.omitted.some((p) => uploadIds.has(p.id)) &&
      this.fitsOnEntry(plan.textLength, withRefs, null, 0, names);

    if (!carriesUploads) {
      const sent = await channel.send(
        await this.renderWithProofs(moderationCase, options, proofs, null),
      );
      await this.adoptAfterPost(sent, moderationCase, proofs, options);
      return sent;
    }

    const sent = await channel.send({
      ...plan.message,
      files: uploads
        .flatMap((u) => u.download.files)
        .map((file, i) => toAttachment(file, names[i] ?? file.name)),
    });

    const urls = uploadedUrls(postedFilesOf(sent), names, new Set());
    const hosted = new Map<string, string[]>();
    for (const { proof, download } of uploads) {
      const own = namesOf.get(proof.id) ?? [];
      const newUrls = own
        .map((name) => urls[names.indexOf(name)])
        .filter((url): url is string => !!url);
      hosted.set(proof.id, [...newUrls, ...download.failed]);
    }
    const current = pending((proof) => hosted.get(proof.id) ?? []).map(
      (proof) =>
        hosted.has(proof.id) ? { ...proof, hostMessageId: sent.id } : proof,
    );

    try {
      for (const { proof } of uploads) {
        await this.saveHosting(proof, hosted.get(proof.id) ?? [], sent.id);
      }
    } catch (err) {
      // The entry is already posted; failing here would post it twice on retry.
      this.logger.warn(
        { err, guildId: moderationCase.guildId, caseId: moderationCase.caseId },
        "Failed to save proof hosting after posting the mod log entry",
      );
      return sent;
    }

    if (names.some((name) => !isGalleryMedia(name))) {
      await this.bestEffortEdit(
        sent,
        await this.renderWithProofs(moderationCase, options, current, sent.id),
        moderationCase,
      );
    }
    await this.adoptAfterPost(sent, moderationCase, current, options);

    return sent;
  }

  /** Moves proof the first post couldn't hold into replies. Best effort. */
  private async adoptAfterPost(
    sent: Message,
    moderationCase: ModerationCase,
    proofs: CaseProof[],
    options: Omit<ModLogRenderOptions, "currentMessage">,
  ): Promise<void> {
    try {
      const adopted = await this.adoptUnhosted(sent, moderationCase, proofs);
      if (adopted.changed) {
        await this.bestEffortEdit(
          adopted.message,
          await this.renderWithProofs(
            moderationCase,
            { ...options, currentMessage: adopted.message },
            adopted.proofs,
            sent.id,
          ),
          moderationCase,
        );
      }
    } catch (err) {
      // The entry is already posted; failing here would post it twice on retry.
      this.logger.warn(
        { err, guildId: moderationCase.guildId, caseId: moderationCase.caseId },
        "Failed to move unhosted proof after posting the mod log entry",
      );
    }
  }

  private fitsOnEntry(
    textLength: number,
    proofs: readonly PlacedProof[],
    entryId: string | null,
    existingFiles: number,
    newNames: readonly string[],
  ): boolean {
    const hasOverflow = proofs.some(
      (p) => p.hostMessageId !== null && p.hostMessageId !== entryId,
    );
    const pendingLinks = newNames.filter((n) => !isGalleryMedia(n)).length;
    const text =
      textLength +
      (hasOverflow ? 0 : MORE_PROOF_LINE_RESERVE) +
      DELETE_DM_PROMPT_RESERVE +
      pendingLinks * FILE_LINK_RESERVE;
    const shown = proofs.filter(
      (p) => p.hostMessageId === null || p.hostMessageId === entryId,
    );

    return (
      text <= MESSAGE_TEXT_MAX_LENGTH &&
      existingFiles + newNames.length <= MESSAGE_FILES_MAX &&
      galleryItemCount(shown) <= MESSAGE_FILES_MAX
    );
  }

  /**
   * Adds one proof to the entry, keeping the files already on it, or posts it
   * as replies when the entry would go over 4000 characters or 10 files.
   * `others` must all fit on the entry already.
   */
  private async placeProof(
    entryMessage: Message,
    moderationCase: ModerationCase,
    others: readonly PlacedProof[],
    proof: ModLogProof,
    files: readonly ProofUpload[],
  ): Promise<PlaceResult> {
    let entry = entryMessage;
    if (files.length > 0 && isLegacyEntry(entry)) {
      entry = await this.convertBeforeUpload(entry, moderationCase, others);
    }

    const existing = postedFiles(postedFilesOf(entry));
    const existingIds = new Set(existing.map((f) => f.id));
    const names = uniqueUploadNames(
      files,
      existing.map((f) => f.filename),
    );
    const refs = names.map((n) => `attachment://${n}`);
    const draft = { ...proof, attachments: refs, hostMessageId: entry.id };
    const onEntry = [...others, draft];
    // Measured without the draft, so an oversized draft never reaches a builder.
    const base = await this.planEntry(
      moderationCase,
      { currentMessage: entry },
      others,
      entry.id,
    );
    const fits = this.fitsOnEntry(
      base.textLength + proofTextLength(draft),
      onEntry,
      entry.id,
      existing.length,
      names,
    );

    if (fits) {
      const rendered = await this.renderWithProofs(
        moderationCase,
        { currentMessage: entry },
        onEntry,
        entry.id,
      );
      const edited = await this.editEntry(entry, moderationCase, rendered, {
        keep: [...existingIds],
        files,
        names,
      });
      const urls = this.collectUrls(edited, names, existingIds, moderationCase);
      if (names.some((n) => !isGalleryMedia(n))) {
        await this.bestEffortEdit(
          edited,
          await this.renderWithProofs(
            moderationCase,
            { currentMessage: edited },
            [
              ...others,
              { ...proof, attachments: urls, hostMessageId: edited.id },
            ],
            edited.id,
          ),
          moderationCase,
        );
      }
      return { hostMessageId: entry.id, attachmentUrls: urls, entry: edited };
    }

    const { firstReplyId, urls } = await this.postReplies(
      entry,
      moderationCase,
      proof,
      files,
      names,
    );

    const hadOverflow = others.some(
      (p) => p.hostMessageId !== null && p.hostMessageId !== entry.id,
    );
    if (!hadOverflow) {
      await this.bestEffortEdit(
        entry,
        await this.renderWithProofs(
          moderationCase,
          { currentMessage: entry },
          [
            ...others,
            { ...proof, attachments: urls, hostMessageId: firstReplyId },
          ],
          entry.id,
        ),
        moderationCase,
      );
    }

    return { hostMessageId: firstReplyId, attachmentUrls: urls, entry };
  }

  /**
   * Posts a proof as a chain of replies to the entry, split at line breaks so
   * no reply passes 4000 characters. The last reply holds the files.
   */
  private async postReplies(
    entry: Message,
    moderationCase: ModerationCase,
    proof: ModLogProof,
    files: readonly ProofUpload[],
    names: readonly string[],
  ): Promise<{ firstReplyId: string; urls: string[] }> {
    const emojis = await this.emojiRepository.getEmojis(MOD_LOG_EMOJIS);
    const pending = {
      ...proof,
      attachments: names.map((n) => `attachment://${n}`),
    };
    const parts = proofReplyParts(
      pending,
      emojis,
      names.filter((n) => !isGalleryMedia(n)).length,
      FILE_LINK_RESERVE,
    );
    const render = (part: (typeof parts)[number]) =>
      buildProofReplyMessage({
        caseId: moderationCase.caseId,
        userId: moderationCase.userId,
        emojis,
        part,
      });

    let previous = entry;
    let firstReplyId: string | null = null;
    let urls: string[] = [];
    for (const part of parts) {
      const isLast = part.index === parts.length - 1;
      const reply = await previous.reply({
        ...render(part),
        files: isLast
          ? files.map((file, i) => toAttachment(file, names[i] ?? file.name))
          : [],
        failIfNotExists: false,
      });
      firstReplyId ??= reply.id;
      previous = reply;

      if (isLast) {
        urls = this.collectUrls(reply, names, new Set(), moderationCase);
        if (names.some((n) => !isGalleryMedia(n))) {
          await this.bestEffortEdit(
            reply,
            render({ ...part, proof: { ...proof, attachments: urls } }),
            moderationCase,
          );
        }
      }
    }

    return { firstReplyId: firstReplyId ?? previous.id, urls };
  }

  private collectUrls(
    message: Message,
    names: readonly string[],
    previousIds: ReadonlySet<string>,
    moderationCase: ModerationCase,
  ): string[] {
    const urls = uploadedUrls(postedFilesOf(message), names, previousIds);
    const missing = names.filter((_, i) => !urls[i]);
    if (missing.length > 0) {
      this.logger.warn(
        {
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          messageId: message.id,
          missing,
        },
        "Mod log message is missing uploaded proof files",
      );
    }

    return urls.filter((url): url is string => !!url);
  }

  private async editEntry(
    entry: Message,
    moderationCase: ModerationCase,
    rendered: ModLogMessage,
    upload: { keep: string[]; files: readonly ProofUpload[]; names: string[] },
  ): Promise<Message> {
    const kind = isLegacyEntry(entry) ? "legacy_conversion" : "v2";
    try {
      let edited = entry;
      if (kind === "legacy_conversion") {
        // Only text-only proof gets here; files convert the entry first.
        await this.convertLegacyEntry(
          entry.channelId,
          entry.id,
          entry.flags.bitfield,
          rendered,
        );
      } else {
        edited = await entry.edit({
          ...rendered,
          // Discord drops every file an edit doesn't list once it uploads new ones.
          attachments: upload.keep.map((id) => ({ id })),
          files: upload.files.map((file, i) =>
            toAttachment(file, upload.names[i] ?? file.name),
          ),
        });
      }
      this.metrics.recordModLogEdit(kind, "ok");
      return edited;
    } catch (err) {
      this.metrics.recordModLogEdit(kind, "failed");
      throw new Error("Failed to add proof to mod log entry", { cause: err });
    }
  }

  /** Files can't go up in the REST conversion, so a legacy entry is converted first. */
  private async convertBeforeUpload(
    entry: Message,
    moderationCase: ModerationCase,
    proofs: readonly PlacedProof[],
  ): Promise<Message> {
    const rendered = await this.renderWithProofs(
      moderationCase,
      { currentMessage: entry },
      proofs,
      entry.id,
    );
    await this.convertLegacyEntry(
      entry.channelId,
      entry.id,
      entry.flags.bitfield,
      rendered,
    );
    this.metrics.recordModLogEdit("legacy_conversion", "ok");
    return entry.fetch(true);
  }

  private async bestEffortEdit(
    message: Message,
    rendered: ModLogMessage,
    moderationCase: ModerationCase,
  ): Promise<void> {
    try {
      if (isLegacyEntry(message)) {
        await this.convertLegacyEntry(
          message.channelId,
          message.id,
          message.flags.bitfield,
          rendered,
        );
      } else {
        await message.edit(rendered);
      }
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          messageId: message.id,
        },
        "Failed to update mod log message after hosting proof",
      );
    }
  }

  /**
   * Moves proof files that live elsewhere (the action response) onto the
   * entry, so the mod log holds every proof file, and moves unhosted text
   * that no longer fits on the entry into replies. Best effort per proof.
   */
  private async adoptUnhosted(
    entryMessage: Message,
    moderationCase: ModerationCase,
    stored: CaseProof[],
  ): Promise<{ proofs: CaseProof[]; message: Message; changed: boolean }> {
    let proofs = stored;
    let message = entryMessage;
    let changed = false;

    const { omitted } = await this.planEntry(
      moderationCase,
      { currentMessage: message },
      stored,
      message.id,
    );
    const work = stored.filter(
      (p) =>
        p.hostMessageId === null &&
        p.source !== "backfill" &&
        (isAdoptable(p) || omitted.includes(p)),
    );

    for (const [index, proof] of work.entries()) {
      const later = new Set(work.slice(index + 1).map((p) => p.id));
      const others = proofs.filter(
        (p) => p.id !== proof.id && !later.has(p.id),
      );

      let files: ProofUpload[] = [];
      let kept = proof.attachments.filter(Boolean);
      if (isAdoptable(proof)) {
        const download = await this.downloadProofFiles(proof);
        files = download.files;
        kept = download.failed;
      }

      if (files.length === 0) {
        const base = await this.planEntry(
          moderationCase,
          { currentMessage: message },
          others,
          message.id,
        );
        const fits = this.fitsOnEntry(
          base.textLength + proofTextLength(proof),
          [...others, proof],
          message.id,
          0,
          [],
        );
        if (fits) {
          continue;
        }
      }

      let placed: PlaceResult;
      try {
        placed = await this.placeProof(
          message,
          moderationCase,
          others,
          proof,
          files,
        );
      } catch (err) {
        this.logger.warn(
          {
            err,
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
            proofId: proof.id,
          },
          "Failed to move proof onto the mod log",
        );
        continue;
      }

      const attachments = [...placed.attachmentUrls, ...kept];
      await this.saveHosting(proof, attachments, placed.hostMessageId);
      changed = true;
      message = placed.entry;
      proofs = proofs.map((p) =>
        p.id === proof.id
          ? { ...p, attachments, hostMessageId: placed.hostMessageId }
          : p,
      );
    }

    return { proofs, message, changed };
  }

  private async saveHosting(
    proof: CaseProof,
    attachments: string[],
    hostMessageId: string,
  ): Promise<void> {
    await this.caseProofRepository.updateHosting(proof.guildId, proof.id, {
      attachments,
      hostMessageId,
    });
  }

  private async downloadProofFiles(proof: CaseProof): Promise<DownloadedProof> {
    const files: ProofUpload[] = [];
    const failed: string[] = [];

    for (const url of proof.attachments.filter(Boolean)) {
      const file = await this.downloadFile(url, proof);
      if (file) {
        files.push(file);
      } else {
        failed.push(url);
      }
    }

    return { files, failed };
  }

  private async downloadFile(
    url: string,
    proof: CaseProof,
  ): Promise<ProofUpload | null> {
    const context = {
      guildId: proof.guildId,
      caseId: proof.caseId,
      proofId: proof.id,
    };
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(PROOF_DOWNLOAD_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          { ...context, status: res.status },
          "Failed to download proof file",
        );
        return null;
      }

      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > PROOF_DOWNLOAD_MAX_BYTES) {
        this.logger.warn(
          { ...context, bytes: data.length },
          "Proof file is too large to move onto the mod log entry",
        );
        return null;
      }

      return {
        name: getCleanFilename(url) || "file",
        data,
        contentType: res.headers.get("content-type"),
      };
    } catch (err) {
      this.logger.warn({ ...context, err }, "Failed to download proof file");
      return null;
    }
  }

  /**
   * Responds to a button or form on the entry by replacing it. A legacy entry
   * is acknowledged and converted over REST.
   *
   * Returns "failed" when that conversion fails. It's logged, not thrown: the
   * interaction is already acknowledged, and an error reply from the router
   * would overwrite the entry itself. The caller tells the mod privately.
   */
  async updateFromInteraction(
    interaction: MessageInteraction,
    message: ModLogMessage,
  ): Promise<"updated" | "failed"> {
    const posted = interaction.message;
    if (!isLegacyEntry(posted)) {
      try {
        await interaction.update(message);
      } catch (err) {
        this.metrics.recordModLogEdit("v2", "failed");
        throw err;
      }
      this.metrics.recordModLogEdit("v2", "ok");
      return "updated";
    }

    // defer: ack-only, the legacy embed is converted over REST because discord.js can't send content: null
    await interaction.deferUpdate();
    try {
      await this.convertLegacyEntry(
        posted.channelId,
        posted.id,
        posted.flags.bitfield,
        message,
      );
      this.metrics.recordModLogEdit("legacy_conversion", "ok");
      return "updated";
    } catch (err) {
      this.metrics.recordModLogEdit("legacy_conversion", "failed");
      this.logger.warn(
        { err, messageId: posted.id, channelId: posted.channelId },
        "Failed to convert legacy mod log entry",
      );
      return "failed";
    }
  }

  async convertLegacyEntry(
    channelId: string,
    messageId: string,
    existingFlags: number,
    message: ModLogMessage,
  ): Promise<void> {
    await this.client.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: buildLegacyConversionBody(message, existingFlags),
    });
  }

  private async resolveUser(userId: string): Promise<User | null> {
    const cached = this.client.users.cache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      return await this.client.users.fetch(userId);
    } catch (err) {
      // The entry still renders from stored data; only the avatar or tag is lost.
      this.logger.warn({ err, userId }, "Failed to fetch mod log user");
      return null;
    }
  }

  private async resolveTag(userId: string): Promise<string | null> {
    return (await this.resolveUser(userId))?.tag ?? null;
  }

  /** Keeps the name the case recorded; deleted accounts lose theirs on Discord. */
  private async resolveTarget(
    moderationCase: ModerationCase,
    known: User | undefined,
  ): Promise<ModLogTarget> {
    const user = known ?? (await this.resolveUser(moderationCase.userId));

    return {
      id: moderationCase.userId,
      username: moderationCase.userTag || user?.tag || moderationCase.userId,
      avatarURL:
        user?.displayAvatarURL?.() ?? defaultAvatarURL(moderationCase.userId),
    };
  }
}
