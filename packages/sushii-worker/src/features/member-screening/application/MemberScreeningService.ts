import opentelemetry, { type Span, SpanStatusCode } from "@opentelemetry/api";
import type { Logger } from "pino";

import { Semaphore } from "@/shared/infrastructure/concurrency/Semaphore";

import type {
  ImageVerdict,
  ScreeningClassifier,
  TextState,
  TextVerdict,
} from "../domain/ScreeningClassifier";
import type { CheckResult, ScreeningMetrics } from "../domain/ScreeningMetrics";
import { extractImageLinks } from "../domain/imageLinks";
import { isTrivialMessage } from "../domain/isTrivialMessage";
import type { ScreeningGuildRepository } from "../domain/repositories/ScreeningGuildRepository";
import type {
  CachedMessage,
  ScreeningMessageContextRepository,
} from "../domain/repositories/ScreeningMessageContextRepository";
import type { ScreeningVerdictRepository } from "../domain/repositories/ScreeningVerdictRepository";
import { rulesFor, topRule } from "../domain/rules";
import {
  ACTION_LOOKBACK_DAYS,
  type ImageKind,
  type JudgedText,
  type NewScreeningVerdict,
  type ScreeningGuildSettings,
  type ScreeningVerdict,
  type VerdictKind,
} from "../domain/types";
import { verdictRef } from "../presentation/views/ScreeningPostView";
import type { ScreeningPostPublisher } from "./ScreeningPostPublisher";
import type { ScreeningPostRenderer } from "./ScreeningPostRenderer";

const tracer = opentelemetry.trace.getTracer("member-screening");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A burst of flagged messages from one member edits the same post instead of posting per message. */
const BURST_MS = 10 * 60 * 1000;
const CONTEXT_MESSAGES = 20;
const TARGET_LINES = 5;
/** Earlier lines from the member go to the classifier, so a split-up scam still reads as one. */
const EARLIER_LINES = 4;
const CONTEXT_LINES = 2;
const STATE_TEXT_MAX = 500;
/** Bounds paid classifier calls in flight per process; a raid would otherwise fan out unbounded. */
export const MAX_CLASSIFIER_CALLS = 4;
/** Verdict columns are NOT NULL; miss and channel-less automod rows have no real id. */
const NO_ID = "0";

interface RawEmbedMedia {
  proxy_url?: string | null;
}

/** The subset of a gateway message that screening reads, kept narrow so tests can build one. */
export interface ScreenedMessage {
  id: string;
  guildId: string;
  channelId: string;
  content: string;
  createdAt: Date;
  embeds: readonly {
    image?: RawEmbedMedia | null;
    thumbnail?: RawEmbedMedia | null;
  }[];
  /** `name` is the display name shown on the judged lines. */
  author: { id: string; avatar: string | null; name: string };
  member: { joinedAt: Date; avatar: string | null };
}

export interface AutomodBlock {
  guildId: string;
  userId: string;
  channelId: string | null;
  /** Blocked messages never exist, so this is the alert message id when there is one. */
  alertMessageId: string | null;
  ruleName: string;
  content: string;
  joinedAt: Date;
}

interface CheckTarget {
  guildId: string;
  channelId: string;
  userId: string;
}

interface ScreenContext {
  msg: ScreenedMessage;
  settings: ScreeningGuildSettings;
  ordinal: number;
  now: Date;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Up to TARGET_LINES of the member's messages, plus the CONTEXT_LINES other messages just before the first of them. */
export function judgedLines(rows: CachedMessage[], userId: string): JudgedText {
  const targetIdx = rows
    .flatMap((r, i) => (r.authorId === userId ? [i] : []))
    .slice(-TARGET_LINES);
  const first = targetIdx[0];
  if (first === undefined) {
    return { context: [], target: [] };
  }

  const context = rows
    .slice(0, first)
    .filter((r) => r.authorId !== userId)
    .slice(-CONTEXT_LINES)
    .map((r) => ({ author: r.authorName, text: r.content }));
  const target = targetIdx.map((i) => ({
    author: rows[i].authorName,
    text: rows[i].content,
  }));

  return { context, target };
}

export class MemberScreeningService {
  private readonly inflight = new Set<string>();
  /** One text check at a time per member, so concurrent checks don't each miss the other's open post. */
  private readonly textChains = new Map<string, Promise<void>>();
  private readonly classifierSlots = new Semaphore(MAX_CLASSIFIER_CALLS);

  constructor(
    private readonly guildRepo: ScreeningGuildRepository,
    private readonly verdictRepo: ScreeningVerdictRepository,
    private readonly contextRepo: ScreeningMessageContextRepository,
    private readonly classifier: ScreeningClassifier,
    private readonly publisher: ScreeningPostPublisher,
    private readonly renderer: ScreeningPostRenderer,
    private readonly metrics: ScreeningMetrics,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Runs the text, avatar and image checks for a new member. Never throws. */
  async screenMessage(
    msg: ScreenedMessage,
    opts: { skipText?: boolean } = {},
  ): Promise<void> {
    try {
      const settings = await this.guildRepo.findByGuildId(msg.guildId);
      if (!settings) {
        return;
      }

      const now = this.now();
      if (!this.inWindow(msg.member.joinedAt, settings, now)) {
        return;
      }

      const earlier = await this.contextRepo.countByAuthorSince(
        msg.guildId,
        msg.author.id,
        msg.member.joinedAt,
        msg.createdAt,
      );
      const ordinal = earlier + 1;
      if (ordinal > settings.maxMessages) {
        return;
      }

      const ctx: ScreenContext = { msg, settings, ordinal, now };
      await Promise.all([
        opts.skipText ? undefined : this.screenText(ctx),
        settings.checkAvatars ? this.screenAvatar(ctx) : undefined,
        this.screenImages(ctx),
      ]);
    } catch (err) {
      this.logger.warn(
        { err, guildId: msg.guildId, messageId: msg.id },
        "Member screening failed",
      );
    }
  }

  /** Scored silently for recall measurement and shown on the member's posts. Never posts: AutoMod already alerted. */
  async recordAutomodBlock(block: AutomodBlock): Promise<void> {
    const settings = await this.guildRepo.findByGuildId(block.guildId);
    if (!settings) {
      return;
    }

    const now = this.now();
    if (!this.inWindow(block.joinedAt, settings, now)) {
      return;
    }

    const target: CheckTarget = {
      guildId: block.guildId,
      channelId: block.channelId ?? NO_ID,
      userId: block.userId,
    };

    await this.inSpan("automod", target, async (span) => {
      let verdict: TextVerdict | null = null;
      let error: string | null = null;
      let result: CheckResult | undefined;
      if (block.content.trim()) {
        // Over the cap the block is still recorded and shown, only unscored.
        const scored = await this.withClassifierSlot(
          settings,
          "automod",
          async () => {
            try {
              return await this.classifier.classifyText(
                {
                  new_message: {
                    text: block.content.slice(0, STATE_TEXT_MAX),
                  },
                },
                rulesFor(settings),
              );
            } catch (err) {
              span.recordException(
                err instanceof Error ? err : new Error(String(err)),
              );
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: "screening automod scoring failed",
              });
              this.logger.warn(
                { err, guildId: block.guildId, userId: block.userId },
                "Screening automod scoring failed",
              );
              return errorMessage(err);
            }
          },
        );
        if (typeof scored === "string") {
          error = scored;
          result = "error";
        } else if (scored) {
          verdict = scored;
          result = "clean";
        }
      }

      await this.saveVerdict(
        {
          ...target,
          messageId: block.alertMessageId ?? NO_ID,
          kind: "automod",
          scores: verdict?.scores ?? null,
          topRule: verdict ? topRule(verdict.scores) : null,
          categories: [block.ruleName],
          flagged: false,
          joinedAt: block.joinedAt,
          model: verdict?.model ?? null,
          cost: verdict?.cost ?? null,
          error,
          createdAt: now,
        },
        { result, span },
      );
    });

    await this.refreshPosts(
      await this.verdictRepo.postedForUser(
        block.guildId,
        block.userId,
        block.joinedAt,
      ),
    );
  }

  /** A ban, kick or timeout marks the member's flags actioned, or records a miss when they were screened but never flagged. */
  async recordModAction(
    guildId: string,
    userId: string,
    action: string,
    by: string | null,
  ): Promise<void> {
    const now = this.now();
    const since = new Date(now.getTime() - ACTION_LOOKBACK_DAYS * DAY_MS);

    const changed = await this.verdictRepo.setActioned(
      guildId,
      userId,
      since,
      by,
      action,
      now,
    );
    if (changed.length > 0) {
      this.metrics.recordOutcome("actioned", { source: "audit_log" });
      this.logger.info(
        { guildId, userId, action, verdicts: changed.length },
        "Screening verdicts actioned",
      );
      await this.refreshPosts(changed);
      return;
    }

    if (!(await this.verdictRepo.hasCheckSince(guildId, userId, since))) {
      return;
    }
    if (await this.verdictRepo.hasFlagSince(guildId, userId, since)) {
      return;
    }
    // A timeout followed by a ban is one miss, not two.
    if (await this.verdictRepo.hasMissSince(guildId, userId, since)) {
      return;
    }

    await this.saveVerdict({
      guildId,
      channelId: NO_ID,
      userId,
      messageId: NO_ID,
      kind: "miss",
      categories: [action],
      outcome: "actioned",
      outcomeBy: by,
      outcomeAction: action,
      outcomeAt: now,
      createdAt: now,
    });
    this.metrics.recordOutcome("missed", { source: "audit_log" });
  }

  async recordMessagesDeleted(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    const rows = await this.verdictRepo.markMessageDeleted(messageIds);
    await this.refreshPosts(rows);
  }

  private inWindow(
    joinedAt: Date,
    settings: ScreeningGuildSettings,
    now: Date,
  ): boolean {
    return now.getTime() - joinedAt.getTime() < settings.windowHours * HOUR_MS;
  }

  private async screenText(ctx: ScreenContext): Promise<void> {
    const { msg } = ctx;
    if (!msg.content.trim()) {
      return;
    }

    if (isTrivialMessage(msg.content)) {
      this.metrics.recordCheck("text", "skipped_trivial", null);
      return;
    }

    await this.serializeText(`${msg.guildId}:${msg.author.id}`, () =>
      this.guard("text", msg, async () => {
        if (await this.overDailyCap(ctx.settings, "text")) {
          return;
        }
        await this.inSpan("text", this.targetOf(msg), (span) =>
          this.runTextCheck(ctx, span),
        );
      }),
    );
  }

  private async runTextCheck(ctx: ScreenContext, span: Span): Promise<void> {
    const { msg, settings, ordinal, now } = ctx;
    const userId = msg.author.id;

    // The cache write for this message races this handler, so the current message comes from the payload.
    const recent = (
      await this.contextRepo.recentInChannel(
        msg.guildId,
        msg.channelId,
        msg.createdAt,
        CONTEXT_MESSAGES,
      )
    )
      .filter((r) => r.messageId !== msg.id)
      // A member who renamed mid-burst should still read as one person.
      .map((r) =>
        r.authorId === userId ? { ...r, authorName: msg.author.name } : r,
      );
    const current: CachedMessage = {
      messageId: msg.id,
      authorId: userId,
      authorName: msg.author.name,
      content: msg.content,
      createdAt: msg.createdAt,
    };

    const earlier = recent
      .filter((r) => r.authorId === userId && r.content.trim())
      .slice(-EARLIER_LINES)
      .map((r) => r.content.slice(0, STATE_TEXT_MAX));
    const state: TextState = {
      new_message: { text: msg.content.slice(0, STATE_TEXT_MAX) },
      ...(earlier.length > 0
        ? { earlier_messages_from_same_member: earlier }
        : {}),
    };

    const base: NewScreeningVerdict = {
      ...this.targetOf(msg),
      messageId: msg.id,
      kind: "text",
      joinedAt: msg.member.joinedAt,
      ordinal,
      judged: judgedLines([...recent, current], userId),
      createdAt: now,
    };

    const row = await this.withClassifierSlot(settings, "text", async () => {
      const verdict = await this.classifyOrRecordError(base, span, () =>
        this.classifier.classifyText(state, rulesFor(settings)),
      );
      const flagged = Object.values(verdict.scores).some(
        (p) => p !== undefined && p >= settings.reviewThreshold,
      );
      return this.saveVerdict(
        {
          ...base,
          scores: verdict.scores,
          topRule: topRule(verdict.scores),
          flagged,
          model: verdict.model,
          cost: verdict.cost,
        },
        { result: flagged ? "flagged" : "clean", span },
      );
    });
    if (!row?.flagged || !settings.logChannelId) {
      return;
    }

    const open = await this.verdictRepo.findOpenTextPost(
      msg.guildId,
      userId,
      new Date(now.getTime() - BURST_MS),
    );
    if (open?.postChannelId && open.postMessageId) {
      await this.verdictRepo.setPost(
        row.id,
        open.postChannelId,
        open.postMessageId,
      );
      const container = await this.renderer.renderPost(open.postMessageId);
      if (!container) {
        return;
      }
      const edited = await this.publisher.edit(
        open.postChannelId,
        open.postMessageId,
        container,
      );
      if (edited === "edited") {
        return;
      }
      // The open post was deleted. postNew re-points this row, so later flags in the burst follow it.
    }

    await this.postNew(row, settings.logChannelId);
  }

  private async screenAvatar(ctx: ScreenContext): Promise<void> {
    const { msg } = ctx;
    const userId = msg.author.id;
    const memberHash = msg.member.avatar;
    const hash = memberHash ?? msg.author.avatar;
    if (!hash) {
      return;
    }

    const key = `pfp:${userId}:${hash}`;
    if (this.inflight.has(key)) {
      return;
    }
    // Claimed before the first await: CREATE and the unfurl UPDATE arrive milliseconds apart.
    this.inflight.add(key);
    try {
      await this.guard("pfp", msg, async () => {
        if (await this.verdictRepo.hasPfpVerdict(userId, hash)) {
          return;
        }
        if (await this.overDailyCap(ctx.settings, "pfp")) {
          return;
        }

        const url = memberHash
          ? `https://cdn.discordapp.com/guilds/${msg.guildId}/users/${userId}/avatars/${hash}.png?size=256`
          : `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=256`;
        await this.inSpan("pfp", this.targetOf(msg), (span) =>
          this.runImageCheck(ctx, span, { kind: "pfp", url, avatarHash: hash }),
        );
      });
    } finally {
      this.inflight.delete(key);
    }
  }

  private async screenImages(ctx: ScreenContext): Promise<void> {
    const { msg } = ctx;
    for (const link of extractImageLinks(msg.content, msg.embeds)) {
      const key = `img:${msg.guildId}:${link.key}`;
      if (this.inflight.has(key)) {
        continue;
      }
      this.inflight.add(key);
      try {
        await this.guard("image", msg, async () => {
          if (await this.verdictRepo.hasImageVerdict(msg.guildId, link.key)) {
            return;
          }
          if (await this.overDailyCap(ctx.settings, "image")) {
            return;
          }

          await this.inSpan("image", this.targetOf(msg), (span) =>
            this.runImageCheck(ctx, span, {
              kind: "image",
              url: link.url,
              imageKey: link.key,
            }),
          );
        });
      } finally {
        this.inflight.delete(key);
      }
    }
  }

  private async runImageCheck(
    ctx: ScreenContext,
    span: Span,
    image: {
      kind: ImageKind;
      url: string;
      avatarHash?: string;
      imageKey?: string;
    },
  ): Promise<void> {
    const { msg, settings, ordinal, now } = ctx;
    const base: NewScreeningVerdict = {
      ...this.targetOf(msg),
      messageId: msg.id,
      kind: image.kind,
      avatarHash: image.avatarHash ?? null,
      imageKey: image.imageKey ?? null,
      sourceUrl: image.url,
      joinedAt: msg.member.joinedAt,
      ordinal,
      createdAt: now,
    };

    const row = await this.withClassifierSlot(
      settings,
      image.kind,
      async () => {
        const verdict: ImageVerdict = await this.classifyOrRecordError(
          base,
          span,
          () => this.classifier.classifyImage(image.url, image.kind),
        );
        return this.saveVerdict(
          {
            ...base,
            categories: verdict.categories,
            judged: { reason: verdict.reason },
            flagged: verdict.unsafe,
            model: verdict.model,
            cost: verdict.cost,
          },
          { result: verdict.unsafe ? "flagged" : "clean", span },
        );
      },
    );

    if (row?.flagged && settings.logChannelId) {
      await this.postNew(row, settings.logChannelId);
    }
  }

  /** The failed verdict is stored so an unreachable link or a provider error isn't retried on every edit. */
  private async classifyOrRecordError<T>(
    base: NewScreeningVerdict,
    span: Span,
    classify: () => Promise<T>,
  ): Promise<T> {
    try {
      return await classify();
    } catch (err) {
      await this.saveVerdict(
        { ...base, error: errorMessage(err) },
        { result: "error", span },
      );
      throw err;
    }
  }

  /**
   * Re-checks the cap once a slot is free, since queued checks may have pushed the count over it.
   * The verdict is inserted inside the slot so the next queued check counts it. Null when over the cap.
   */
  private withClassifierSlot<T>(
    settings: ScreeningGuildSettings,
    kind: VerdictKind,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    return this.classifierSlots.run(async () => {
      if (await this.overDailyCap(settings, kind)) {
        return null;
      }
      return fn();
    });
  }

  /** Counts text, pfp and image verdicts only: automod blocks are always recorded for recall, and their scoring is bounded by this check. */
  private async overDailyCap(
    settings: ScreeningGuildSettings,
    kind: VerdictKind,
  ): Promise<boolean> {
    const checks = await this.verdictRepo.countChecksToday(settings.guildId);
    if (checks < settings.dailyCheckCap) {
      return false;
    }

    this.metrics.recordCheck(kind, "skipped_cap", null);
    return true;
  }

  private async postNew(
    row: ScreeningVerdict,
    channelId: string,
  ): Promise<void> {
    const container = await this.renderer.render(row);
    const postId = await this.publisher.post(channelId, container);
    await this.verdictRepo.setPost(row.id, channelId, postId);
  }

  /** Re-renders each distinct post once. Best-effort: the verdicts are already stored, a stale post is only cosmetic. */
  async refreshPosts(verdicts: ScreeningVerdict[]): Promise<void> {
    const posts = new Map<string, string>();
    for (const r of verdicts) {
      if (r.postChannelId && r.postMessageId) {
        posts.set(r.postMessageId, r.postChannelId);
      }
    }

    for (const [postMessageId, postChannelId] of posts) {
      try {
        const container = await this.renderer.renderPost(postMessageId);
        if (!container) {
          continue;
        }
        const edited = await this.publisher.edit(
          postChannelId,
          postMessageId,
          container,
        );
        if (edited === "gone") {
          this.logger.debug(
            { postChannelId, postMessageId },
            "Screening post is gone, skipped refresh",
          );
        }
      } catch (err) {
        this.logger.warn(
          { err, postChannelId, postMessageId },
          "Failed to refresh screening post",
        );
      }
    }
  }

  /** The post footer shows `scr-<id>`, so a pasted ref finds this metadata-only line and its trace. */
  private async saveVerdict(
    verdict: NewScreeningVerdict,
    opts: { result?: CheckResult; span?: Span } = {},
  ): Promise<ScreeningVerdict> {
    const { result, span } = opts;
    const row = await this.verdictRepo.insert(verdict);

    span?.setAttributes({
      "screening.verdict_id": row.id,
      "screening.flagged": row.flagged,
      ...(row.topRule ? { "screening.top_rule": row.topRule } : {}),
      ...(row.cost !== null ? { "screening.cost": row.cost } : {}),
    });
    if (result) {
      this.metrics.recordCheck(row.kind, result, row.cost);
    }
    this.logger.info(
      {
        verdictId: row.id,
        ref: verdictRef(row.id),
        kind: row.kind,
        guildId: row.guildId,
        channelId: row.channelId,
        userId: row.userId,
        flagged: row.flagged,
        topRule: row.topRule,
        cost: row.cost,
        hasError: row.error !== null,
      },
      "Screening verdict",
    );

    return row;
  }

  private targetOf(msg: ScreenedMessage): CheckTarget {
    return {
      guildId: msg.guildId,
      channelId: msg.channelId,
      userId: msg.author.id,
    };
  }

  private serializeText(key: string, run: () => Promise<void>): Promise<void> {
    const next = (this.textChains.get(key) ?? Promise.resolve()).then(run, run);
    // The caller still gets `next`; the stored chain only has to settle.
    const settled = next.catch(() => undefined);
    this.textChains.set(key, settled);
    void settled.then(() => {
      if (this.textChains.get(key) === settled) {
        this.textChains.delete(key);
      }
    });
    return next;
  }

  /** Isolates one check's failure from the others (the verdict, if any, is already stored). */
  private async guard(
    kind: VerdictKind,
    msg: ScreenedMessage,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        {
          err,
          kind,
          guildId: msg.guildId,
          channelId: msg.channelId,
          userId: msg.author.id,
          messageId: msg.id,
        },
        "Screening check failed",
      );
    }
  }

  private inSpan<T>(
    kind: VerdictKind,
    target: CheckTarget,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return tracer.startActiveSpan(
      "screening.check",
      {
        attributes: {
          "screening.kind": kind,
          "guild.id": target.guildId,
          "channel.id": target.channelId,
          "user.id": target.userId,
        },
      },
      async (span) => {
        try {
          return await fn(span);
        } catch (err) {
          span.recordException(
            err instanceof Error ? err : new Error(String(err)),
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "screening check failed",
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }
}
