import { sleep } from "bun";
import type {
  ButtonInteraction,
  Client,
  Message,
  ModalMessageModalSubmitInteraction,
  SendableChannels,
  TextBasedChannel,
  User,
} from "discord.js";
import {
  AttachmentBuilder,
  DiscordAPIError,
  RESTJSONErrorCodes,
  Routes,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

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
import { KeyedMutex } from "./KeyedMutex";
import {
  BoundedSet,
  type ProofUpload,
  downloadProofFile,
  isDownloadableProofUrl,
  postedFiles,
  postedFilesOf,
  proofAttachmentRef,
  uniqueUploadNames,
  uploadedUrls,
} from "./proofHosting";

export type { ProofUpload } from "./proofHosting";

export type ProofRemoveResult = "removed" | "already_removed" | "failed";

/**
 * - `hosted`: files went on the entry or an overflow reply to it
 * - `text_only`: no files; hostMessageId is where the text shows, null when there's no entry yet
 * - `retry_later`: files given, but the entry is still being posted or couldn't be fetched
 * - `no_mod_log`: files given, but there's no mod log channel or the case never got an entry
 */
export type ProofHostResult =
  | { kind: "hosted"; hostMessageId: string; attachmentUrls: string[] }
  | { kind: "text_only"; hostMessageId: string | null }
  | { kind: "retry_later" }
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
const PROOF_DOWNLOAD_TOTAL_MS = 20_000;
// Matches the 25 MB cap on proof uploads: a file the guild accepted once fits its mod log too.
const PROOF_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

export interface PendingEntryWait {
  totalMs: number;
  pollMs: number;
}

const PENDING_ENTRY_WAIT: PendingEntryWait = { totalMs: 5_000, pollMs: 1_000 };

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

interface EntryPlan<P> {
  message: ModLogMessage;
  /** Unhosted proof left off because the entry is full. */
  omitted: P[];
  /** Entry-hosted proof that no longer fits, e.g. after a longer reason, newest first. */
  moved: P[];
  textLength: number;
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
  /** With `failed`: the channel or message is gone or inaccessible, so retrying won't help. */
  gone?: boolean;
  /** With `failed`: the channel or message no longer exists. */
  deleted?: boolean;
}

const GONE_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.MissingAccess,
]);

/** Lost access isn't here: the message may still exist and show its files. */
function isDeletedError(err: unknown): boolean {
  return (
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.UnknownMessage ||
      err.code === RESTJSONErrorCodes.UnknownChannel)
  );
}

function isGoneError(err: unknown): boolean {
  return err instanceof DiscordAPIError && GONE_CODES.has(Number(err.code));
}

type MessageInteraction =
  | ButtonInteraction<"cached">
  | ModalMessageModalSubmitInteraction<"cached">;

/**
 * - `files`: downloaded, ready to upload
 * - `kept`: URLs that stay as they are (other hosts, too large)
 * - `dead`: URLs Discord no longer serves; they stay in the row
 * - `retry`: a download failed in a way worth retrying, so nothing moves this time
 */
interface DownloadedProof {
  /** The row's attachments when downloaded, to spot a row changed since. */
  source: string[];
  files: ProofUpload[];
  kept: string[];
  dead: string[];
  retry: boolean;
}

/**
 * Files hosted nowhere on the mod log yet. Backfilled rows are skipped: their
 * links are old slash-command uploads that Discord has already deleted.
 */
function isAdoptable(proof: CaseProof): boolean {
  return (
    proof.hostMessageId === null &&
    proof.source !== "backfill" &&
    proof.attachments.some(isDownloadableProofUrl)
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

/** Proof the entry can't show that only needs a text reply, no upload. */
function relocatable<P extends PlacedProof>(plan: EntryPlan<P>): P[] {
  return [
    ...plan.moved,
    ...plan.omitted.filter((p) => !p.attachments.some(Boolean)),
  ];
}

function needsRelocation(plan: EntryPlan<PlacedProof>): boolean {
  return relocatable(plan).length > 0;
}

const RECENT_CASE_MS = 60_000;

function isRecent(moderationCase: ModerationCase): boolean {
  return Date.now() - moderationCase.actionTime.getTime() < RECENT_CASE_MS;
}

/** URLs Discord answered 404/410 for, so adoption stops retrying them. In-process only. */
const deadFiles = new BoundedSet<string>(1000);

function caseKey(moderationCase: ModerationCase): string {
  return `${moderationCase.guildId}:${moderationCase.caseId}`;
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
 *
 * Work that reads an entry's files and then edits it is serialised per case,
 * so no edit is built from a stale list of the files to keep.
 */
export class ModLogMessageService {
  private readonly caseLock = new KeyedMutex();

  constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly modLogRepository: Pick<
      ModLogRepository,
      "markDmDeleted" | "findById"
    >,
    private readonly caseProofRepository: CaseProofRepository,
    private readonly logger: Logger,
    private readonly metrics: Pick<
      ModerationMetrics,
      "recordModLogEdit"
    > = NOOP_MODERATION_METRICS,
    private readonly pendingEntryWait: PendingEntryWait = PENDING_ENTRY_WAIT,
  ) {}

  /**
   * Renders the case's entry. Given the posted entry, proof that no longer
   * fits on it is moved into replies first, so nothing is left off. Throws
   * when that move is needed but can't happen now; it never waits on other
   * work for the case.
   */
  async render(
    moderationCase: ModerationCase,
    options: ModLogRenderOptions = {},
  ): Promise<ModLogMessage> {
    const entry = options.currentMessage;
    const stored = await this.listProofs(moderationCase);
    if (!entry || entry.id !== moderationCase.msgId) {
      return this.renderWithProofs(moderationCase, options, stored);
    }

    const proofs = await this.withRelocation(
      entry,
      moderationCase,
      options,
      stored,
    );
    if (!proofs) {
      throw new Error("Mod log entry is full and its proof couldn't be moved", {
        cause: {
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
        },
      });
    }
    return this.renderWithProofs(moderationCase, options, proofs, entry.id);
  }

  /**
   * The proof list after moving what no longer fits on the entry into
   * replies. null when that's needed but another task holds the case or a
   * reply fails; rendering then would hide proof.
   */
  private async withRelocation(
    entry: Message,
    moderationCase: ModerationCase,
    options: ModLogRenderOptions,
    stored: CaseProof[],
  ): Promise<CaseProof[] | null> {
    const planOptions = { ...options, currentMessage: entry };
    const plan = await this.planEntry(
      moderationCase,
      planOptions,
      stored,
      entry.id,
    );
    if (!needsRelocation(plan)) {
      return stored;
    }

    const relocated = await this.caseLock.tryRun(
      caseKey(moderationCase),
      async () =>
        this.relocateOverflow(
          entry,
          moderationCase,
          await this.listProofs(moderationCase),
          planOptions,
        ),
    );
    if (!relocated?.complete) {
      this.logger.warn(
        {
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          busy: relocated === null,
        },
        "Mod log entry needs proof moved into replies; left unedited for now",
      );
      return null;
    }

    return relocated.proofs;
  }

  private listProofs(moderationCase: ModerationCase): Promise<CaseProof[]> {
    return this.caseProofRepository.listByCase(
      moderationCase.guildId,
      moderationCase.caseId,
    );
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

  /**
   * Renders the entry with as much proof as fits. Entry-hosted proof stays
   * unless it no longer fits (newest goes first); unhosted proof is added
   * while it fits.
   */
  private async planEntry<P extends PlacedProof>(
    moderationCase: ModerationCase,
    options: ModLogRenderOptions,
    proofs: readonly P[],
    entryId: string | null,
  ): Promise<EntryPlan<P>> {
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

    // A shown confirm prompt is already in the text; otherwise keep room for it.
    const limit =
      MESSAGE_TEXT_MAX_LENGTH -
      (viewOptions.confirmDeleteDm ? 0 : DELETE_DM_PROMPT_RESERVE);
    const base = messageTextLength(build([]));

    const onEntry = proofs.filter(
      (p) => entryId !== null && p.hostMessageId === entryId,
    );
    const moved: P[] = [];
    let length = base + onEntry.reduce((n, p) => n + proofTextLength(p), 0);
    if (length > limit) {
      const linkLine = overflowHost ? 0 : MORE_PROOF_LINE_RESERVE;
      while (onEntry.length > 0 && length + linkLine > limit) {
        const newest = onEntry.pop() as P;
        moved.push(newest);
        length -= proofTextLength(newest);
      }
    }

    const shown = new Set<P>(onEntry);
    for (const proof of proofs.filter((p) => p.hostMessageId === null)) {
      const added = proofTextLength(proof);
      if (length + added <= limit) {
        shown.add(proof);
        length += added;
      }
    }

    return {
      message: build(proofs.filter((p) => shown.has(p))),
      omitted: proofs.filter((p) => p.hostMessageId === null && !shown.has(p)),
      moved,
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

  /**
   * Fetches the case's posted entry and syncs a legacy DM deletion. `fresh`
   * skips the message cache, which an edit doesn't update until the gateway
   * echoes it.
   */
  async loadEntry(
    moderationCase: ModerationCase,
    options: { fresh?: boolean } = {},
  ): Promise<ModLogEntry> {
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
        return {
          moderationCase,
          message: null,
          missing: "failed",
          gone: true,
        };
      }
      message = options.fresh
        ? await channel.messages.fetch({
            message: moderationCase.msgId,
            force: true,
          })
        : await channel.messages.fetch(moderationCase.msgId);
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
      return {
        moderationCase,
        message: null,
        missing: "failed",
        gone: isGoneError(err),
        deleted: isDeletedError(err),
      };
    }

    return {
      moderationCase: await this.syncLegacyDeletedDm(moderationCase, message),
      message,
      missing: null,
    };
  }

  /**
   * Re-renders a loaded entry. Pass the entry's case or a newer copy of it.
   * Proof text that no longer fits moves into replies; when that can't
   * happen now (another task holds the case, or a reply fails) the entry is
   * left as is and "failed" is returned. Files are never downloaded or
   * uploaded here (see adoptUnhosted). Discord failures are logged and
   * returned; repository errors throw.
   */
  async refreshEntry(
    entry: Pick<ModLogEntry, "message" | "missing">,
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<ModLogRefreshOutcome> {
    // A deleted or inaccessible entry isn't an edit failure.
    const message = entry.message;
    if (!message) {
      return entry.missing ?? "no_message";
    }

    const proofs = await this.withRelocation(
      message,
      moderationCase,
      options,
      await this.listProofs(moderationCase),
    );
    if (!proofs) {
      return "failed";
    }

    const rendered = await this.renderWithProofs(
      moderationCase,
      { ...options, currentMessage: message },
      proofs,
      message.id,
    );
    return this.applyRefresh(message, moderationCase, rendered);
  }

  private async applyRefresh(
    message: Message,
    moderationCase: ModerationCase,
    rendered: ModLogMessage,
    keepFiles?: readonly string[],
  ): Promise<ModLogRefreshOutcome> {
    const kind = isLegacyEntry(message) ? "legacy_conversion" : "v2";
    try {
      if (kind === "legacy_conversion") {
        await this.convertLegacyEntry(
          message.channelId,
          message.id,
          message.flags.bitfield,
          rendered,
        );
      } else if (keepFiles) {
        await message.edit({
          ...rendered,
          attachments: keepFiles.map((id) => ({ id })),
        });
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

  /** loadEntry then refreshEntry. Discord failures are returned, not thrown. */
  async refresh(
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<ModLogRefreshOutcome> {
    const entry = await this.loadEntry(moderationCase);
    return this.refreshEntry(entry, entry.moderationCase, options);
  }

  /**
   * Puts a new proof entry on the case's mod log entry, or in replies to it
   * when the entry is full. The caller stores the row with the result.
   * Waits a few seconds for an entry that's still being posted. Throws when
   * Discord rejects the edit or reply.
   */
  async hostProof(
    moderationCase: ModerationCase,
    draft: NewCaseProof,
    files: ProofUpload[],
  ): Promise<ProofHostResult> {
    // Waits unlocked: the audit log post that creates the entry needs the lock.
    const waited = await this.awaitEntry(moderationCase, files.length > 0);
    if (!waited.message) {
      return this.missingEntryResult(waited, files);
    }

    return this.caseLock.run(caseKey(moderationCase), async () => {
      const entry = await this.loadEntry(waited.moderationCase, {
        fresh: true,
      });
      if (!entry.message) {
        return this.missingEntryResult(entry, files);
      }

      const relocated = await this.relocateOverflow(
        entry.message,
        entry.moderationCase,
        await this.listProofs(moderationCase),
      );
      if (!relocated.complete) {
        throw new Error("Failed to move proof off a full mod log entry", {
          cause: {
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
          },
        });
      }

      const placed = await this.placeProof(
        entry.message,
        entry.moderationCase,
        relocated.proofs,
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
    });
  }

  /**
   * Removes a proof and the files sushii hosted for it. Discord goes first
   * and the row last, so a failure keeps the row and the undo can be retried
   * instead of leaving a file with nothing pointing at it. Returns "failed"
   * whenever it can't tell that the files are gone.
   */
  async removeProof(
    moderationCase: ModerationCase,
    proofId: string,
  ): Promise<ProofRemoveResult> {
    let latest = moderationCase;
    const result = await this.caseLock.run(
      caseKey(moderationCase),
      async (): Promise<ProofRemoveResult> => {
        latest =
          (await this.modLogRepository.findById(
            moderationCase.guildId,
            moderationCase.caseId,
          )) ?? moderationCase;
        const entry = await this.loadEntry(latest, { fresh: true });

        const stored = await this.listProofs(moderationCase);
        const proof = stored.find((p) => p.id === proofId);
        if (!proof) {
          return "already_removed";
        }

        const onDiscord =
          proof.hostMessageId !== null ||
          proof.attachments.some((url) => proofAttachmentRef(url));
        if (
          !entry.message &&
          onDiscord &&
          !(await this.entryDeletedWithFiles(entry, proof))
        ) {
          return "failed";
        }

        if (entry.message) {
          const updated = await this.dropFromEntry(
            entry.message,
            entry.moderationCase,
            proof,
            stored.filter((p) => p.id !== proofId),
          );
          if (updated !== "updated") {
            return "failed";
          }
        }

        // Text moved to a reply leaves its files on the entry, so both are checked.
        if (proof.hostMessageId && proof.hostMessageId !== latest.msgId) {
          const deleted = await this.deleteHostReplies(
            latest,
            proof,
            proof.hostMessageId,
          );
          if (!deleted) {
            return "failed";
          }
        }

        await this.caseProofRepository.remove(moderationCase.guildId, proofId);
        return "removed";
      },
    );

    if (result === "removed") {
      await this.refreshAfterRemoval(latest);
    }
    return result;
  }

  /** Refreshes don't take the case lock, so one that read the row before it went can restore the proof. */
  private async refreshAfterRemoval(
    moderationCase: ModerationCase,
  ): Promise<void> {
    try {
      await this.refresh(moderationCase);
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
        },
        "Failed to refresh mod log entry after removing proof",
      );
    }
  }

  /**
   * A moved mod log channel also fetches as Unknown Message, so the files'
   * own channel has to match for the entry to really be gone with them.
   */
  private async entryDeletedWithFiles(
    entry: ModLogEntry,
    proof: CaseProof,
  ): Promise<boolean> {
    if (!entry.deleted) {
      return false;
    }
    const config = await this.guildConfigRepository.findByGuildId(
      proof.guildId,
    );
    const channelId = config.loggingSettings.modLogChannel;
    return proof.attachments
      .flatMap((url) => proofAttachmentRef(url) ?? [])
      .every((ref) => ref.channelId === channelId);
  }

  private async dropFromEntry(
    entry: Message,
    moderationCase: ModerationCase,
    proof: CaseProof,
    others: readonly CaseProof[],
  ): Promise<ModLogRefreshOutcome> {
    const removed = new Set(
      proof.attachments.map((url) => proofAttachmentRef(url)?.attachmentId),
    );
    const keep = postedFiles(postedFilesOf(entry))
      .map((file) => file.id)
      .filter((id) => !removed.has(id));
    const rendered = await this.renderWithProofs(
      moderationCase,
      { currentMessage: entry },
      others,
      entry.id,
    );
    return this.applyRefresh(entry, moderationCase, rendered, keep);
  }

  /**
   * Deletes a proof's reply chain. Only the first reply's id is stored and
   * the files are on the last, so the rest are found by what they reply to.
   */
  private async deleteHostReplies(
    moderationCase: ModerationCase,
    proof: CaseProof,
    firstId: string,
  ): Promise<boolean> {
    const config = await this.guildConfigRepository.findByGuildId(
      moderationCase.guildId,
    );
    const channelId = config.loggingSettings.modLogChannel;
    if (!channelId) {
      return false;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        return false;
      }

      const later = await channel.messages.fetch({
        after: firstId,
        limit: 100,
      });
      const chain = [firstId];
      let next = firstId;
      for (;;) {
        const current = next;
        const reply = later.find(
          (m) =>
            m.author.id === this.client.user?.id &&
            m.reference?.messageId === current,
        );
        if (!reply) {
          break;
        }
        chain.push(reply.id);
        next = reply.id;
      }

      for (const id of chain.reverse()) {
        await this.deleteIfPresent(channel, id);
      }
      return true;
    } catch (err) {
      if (isDeletedError(err)) {
        return true;
      }
      this.logger.warn(
        {
          err,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          proofId: proof.id,
        },
        "Failed to delete proof replies",
      );
      return false;
    }
  }

  private async deleteIfPresent(
    channel: TextBasedChannel,
    messageId: string,
  ): Promise<void> {
    try {
      await channel.messages.delete(messageId);
    } catch (err) {
      if (!isDeletedError(err)) {
        throw err;
      }
    }
  }

  private missingEntryResult(
    entry: ModLogEntry,
    files: readonly ProofUpload[],
  ): ProofHostResult {
    if (files.length === 0) {
      return { kind: "text_only", hostMessageId: null };
    }

    const retry =
      entry.missing === "pending" ||
      (entry.missing === "failed" && !entry.gone) ||
      (entry.missing === "no_message" && isRecent(entry.moderationCase));
    return retry ? { kind: "retry_later" } : { kind: "no_mod_log" };
  }

  /**
   * The case's entry, waiting a few seconds while it's being posted. The
   * audit log path clears `pending` before it posts and stores the message
   * ID after, so a recent case without an entry may be mid-post too.
   */
  private async awaitEntry(
    moderationCase: ModerationCase,
    wait: boolean,
  ): Promise<ModLogEntry> {
    let entry = await this.loadEntry(moderationCase);
    const deadline = Date.now() + this.pendingEntryWait.totalMs;
    while (wait && (await this.mayBePosting(entry)) && Date.now() < deadline) {
      await sleep(this.pendingEntryWait.pollMs);
      const current = await this.modLogRepository.findById(
        moderationCase.guildId,
        moderationCase.caseId,
      );
      if (!current) {
        break;
      }
      entry = await this.loadEntry(current);
    }

    return entry;
  }

  private async mayBePosting(entry: ModLogEntry): Promise<boolean> {
    if (entry.missing === "pending") {
      return true;
    }
    if (entry.missing !== "no_message" || !isRecent(entry.moderationCase)) {
      return false;
    }

    const config = await this.guildConfigRepository.findByGuildId(
      entry.moderationCase.guildId,
    );
    return (
      !!config.loggingSettings.modLogChannel &&
      config.loggingSettings.modLogEnabled
    );
  }

  /**
   * Moves proof files that live elsewhere (the action response) onto the
   * case's entry or replies to it, so the mod log holds every proof file.
   * Downloads with the case unlocked, then uploads with it locked. Call it
   * outside an interaction's 3 seconds.
   */
  async adoptUnhosted(moderationCase: ModerationCase): Promise<void> {
    // Checked first: it runs for every audit log case, and most have nothing to move.
    if (!(await this.listProofs(moderationCase)).some(isAdoptable)) {
      return;
    }

    const entry = await this.loadEntry(moderationCase);
    if (!entry.message) {
      return;
    }

    await this.adoptOnto(entry.message.id, entry.moderationCase, {});
  }

  /**
   * Downloads unhosted proof files, then, with the case locked, re-reads the
   * entry and proof and uploads what's still unhosted.
   */
  private async adoptOnto(
    entryId: string,
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage">,
    posted?: Message,
  ): Promise<void> {
    const downloads = await this.downloadAll(
      (await this.listProofs(moderationCase)).filter(isAdoptable),
    );

    await this.caseLock.run(caseKey(moderationCase), async () => {
      let message = posted ?? null;
      let current = moderationCase;
      if (!message) {
        const entry = await this.loadEntry(moderationCase, { fresh: true });
        if (entry.message?.id !== entryId) {
          return;
        }
        message = entry.message;
        current = entry.moderationCase;
      }

      const adopted = await this.adoptInto(
        message,
        current,
        await this.listProofs(moderationCase),
        downloads,
      );
      if (adopted.changed) {
        await this.applyRefresh(
          adopted.message,
          current,
          await this.renderWithProofs(
            current,
            { ...options, currentMessage: adopted.message },
            adopted.proofs,
            adopted.message.id,
          ),
        );
      }
    });
  }

  private async downloadAll(
    proofs: readonly CaseProof[],
  ): Promise<Map<string, DownloadedProof>> {
    const downloads = new Map<string, DownloadedProof>();
    const deadline = Date.now() + PROOF_DOWNLOAD_TOTAL_MS;
    for (const proof of proofs) {
      downloads.set(proof.id, await this.downloadProofFiles(proof, deadline));
    }
    return downloads;
  }

  /**
   * Posts a new entry and returns once it's sent. Proof files not hosted
   * anywhere yet then move onto it (or replies) in the background, since a
   * refresh may never run for this case.
   */
  async postEntry(
    channel: SendableChannels,
    moderationCase: ModerationCase,
    options: Omit<ModLogRenderOptions, "currentMessage"> = {},
  ): Promise<Message> {
    const sent = await this.caseLock.run(caseKey(moderationCase), async () =>
      channel.send(
        await this.renderWithProofs(
          moderationCase,
          options,
          await this.listProofs(moderationCase),
          null,
        ),
      ),
    );

    // Detached so the caller can store the message ID now; hostProof waits on it.
    void this.adoptOnto(sent.id, moderationCase, options, sent).catch(
      (err: unknown) => {
        this.logger.warn(
          {
            err,
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
          },
          "Failed to host proof after posting the mod log entry",
        );
      },
    );

    return sent;
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
    const draft = {
      ...proof,
      attachments: [...refs, ...proof.attachments],
      hostMessageId: entry.id,
    };
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
              {
                ...draft,
                attachments: [...urls, ...proof.attachments],
                hostMessageId: edited.id,
              },
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
            {
              ...proof,
              attachments: [...urls, ...proof.attachments],
              hostMessageId: firstReplyId,
            },
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
   * no reply passes 4000 characters. The last reply holds the files. If a
   * reply fails, the ones already posted are deleted.
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
      attachments: [
        ...names.map((n) => `attachment://${n}`),
        ...proof.attachments,
      ],
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

    const posted: Message[] = [];
    let previous = entry;
    let urls: string[] = [];
    try {
      for (const part of parts) {
        const isLast = part.index === parts.length - 1;
        const reply = await previous.reply({
          ...render(part),
          files: isLast
            ? files.map((file, i) => toAttachment(file, names[i] ?? file.name))
            : [],
          failIfNotExists: false,
        });
        posted.push(reply);
        previous = reply;

        if (isLast) {
          urls = this.collectUrls(reply, names, new Set(), moderationCase);
        }
      }
    } catch (err) {
      await this.deleteReplies(posted, moderationCase);
      throw new Error("Failed to post proof replies", { cause: err });
    }

    const last = posted.at(-1);
    const lastPart = parts.at(-1);
    if (last && lastPart && names.some((n) => !isGalleryMedia(n))) {
      await this.bestEffortEdit(
        last,
        render({
          ...lastPart,
          proof: { ...proof, attachments: [...urls, ...proof.attachments] },
        }),
        moderationCase,
      );
    }

    return { firstReplyId: posted[0]?.id ?? entry.id, urls };
  }

  private async deleteReplies(
    replies: readonly Message[],
    moderationCase: ModerationCase,
  ): Promise<void> {
    for (const reply of replies) {
      try {
        await reply.delete();
      } catch (err) {
        this.logger.warn(
          {
            err,
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
            messageId: reply.id,
          },
          "Failed to delete a partly posted proof reply",
        );
      }
    }
  }

  /**
   * Moves proof text the entry can no longer hold into replies: entry-hosted
   * proof after the entry grew, and unhosted text-only proof. Files stay
   * where they are. Stops at the first failure. Call with the case locked.
   */
  private async relocateOverflow(
    entry: Message,
    moderationCase: ModerationCase,
    stored: CaseProof[],
    options: ModLogRenderOptions = { currentMessage: entry },
  ): Promise<{ proofs: CaseProof[]; complete: boolean }> {
    const plan = await this.planEntry(
      moderationCase,
      { ...options, currentMessage: entry },
      stored,
      entry.id,
    );
    const movable = new Set<CaseProof>(relocatable(plan));
    let proofs = stored;
    for (const proof of stored.filter((p) => movable.has(p))) {
      let firstReplyId: string;
      try {
        ({ firstReplyId } = await this.postReplies(
          entry,
          moderationCase,
          proof,
          [],
          [],
        ));
      } catch (err) {
        this.logger.warn(
          {
            err,
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
            proofId: proof.id,
          },
          "Failed to move proof that no longer fits into a reply",
        );
        return { proofs, complete: false };
      }

      await this.saveHosting(proof, proof.attachments, firstReplyId);
      proofs = proofs.map((p) =>
        p.id === proof.id ? { ...p, hostMessageId: firstReplyId } : p,
      );
    }

    return { proofs, complete: true };
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
      } else if (upload.files.length === 0) {
        edited = await entry.edit(rendered);
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
   * Uploads already-downloaded unhosted proof files onto the entry or into
   * replies, one proof at a time. Call with the case locked. A proof whose
   * downloads might work later is left for the next try. URLs are never
   * removed from a row: files Discord no longer serves stay listed.
   */
  private async adoptInto(
    entryMessage: Message,
    moderationCase: ModerationCase,
    stored: CaseProof[],
    downloaded: ReadonlyMap<string, DownloadedProof>,
  ): Promise<{ proofs: CaseProof[]; message: Message; changed: boolean }> {
    let proofs = stored;
    let message = entryMessage;
    let changed = false;

    const work = stored.filter(isAdoptable);
    for (const [index, proof] of work.entries()) {
      const download = downloaded.get(proof.id);
      if (
        !download ||
        download.retry ||
        download.files.length === 0 ||
        download.source.join("\n") !== proof.attachments.join("\n")
      ) {
        continue;
      }

      const later = new Set(work.slice(index + 1).map((p) => p.id));
      const others = proofs.filter(
        (p) => p.id !== proof.id && !later.has(p.id),
      );
      const stays = [...download.kept, ...download.dead];
      let placed: PlaceResult;
      try {
        placed = await this.placeProof(
          message,
          moderationCase,
          others,
          { ...proof, attachments: stays },
          download.files,
        );
      } catch (err) {
        this.logger.warn(
          {
            err,
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
            proofId: proof.id,
          },
          "Failed to move proof files onto the mod log",
        );
        continue;
      }

      const attachments = [...placed.attachmentUrls, ...stays];
      await this.saveHosting(proof, attachments, placed.hostMessageId);
      changed = true;
      message = placed.entry;
      proofs = proofs.map((p) =>
        p.id === proof.id
          ? { ...p, attachments, hostMessageId: placed.hostMessageId }
          : p,
      );
    }

    const relocated = await this.relocateOverflow(
      message,
      moderationCase,
      proofs,
    );
    return {
      proofs: relocated.proofs,
      message,
      changed: changed || relocated.proofs !== proofs,
    };
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

  private async downloadProofFiles(
    proof: CaseProof,
    deadline: number,
  ): Promise<DownloadedProof> {
    const result: DownloadedProof = {
      source: [...proof.attachments],
      files: [],
      kept: [],
      dead: [],
      retry: false,
    };
    const context = {
      guildId: proof.guildId,
      caseId: proof.caseId,
      proofId: proof.id,
    };

    for (const url of proof.attachments.filter(Boolean)) {
      if (!isDownloadableProofUrl(url)) {
        result.kept.push(url);
        continue;
      }
      if (deadFiles.has(url)) {
        result.dead.push(url);
        continue;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.logger.warn(context, "Ran out of time downloading proof files");
        return { ...result, retry: true };
      }

      const download = await downloadProofFile(url, {
        signal: AbortSignal.timeout(remaining),
        maxBytes: PROOF_DOWNLOAD_MAX_BYTES,
      });
      switch (download.kind) {
        case "ok":
          result.files.push(download.file);
          break;
        case "dead":
          deadFiles.add(url);
          this.logger.warn(
            { ...context, status: download.status, url },
            "Proof file is gone from Discord; leaving it listed",
          );
          result.dead.push(url);
          break;
        case "too_large":
          this.logger.warn(
            { ...context, bytes: download.bytes },
            "Proof file is too large to move onto the mod log",
          );
          result.kept.push(url);
          break;
        case "transient":
          this.logger.warn(
            { ...context, err: download.err, status: download.status },
            "Failed to download proof file",
          );
          return { ...result, retry: true };
      }
    }

    return result;
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
