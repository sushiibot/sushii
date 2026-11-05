import { sleep as bunSleep } from "bun";
import type { APIChannel, APIMessage, Client, Guild } from "discord.js";
import {
  DiscordAPIError,
  HTTPError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  RateLimitError,
  Routes,
} from "discord.js";
import type { Logger } from "pino";

import type { CommandMentions } from "@/shared/presentation/commandMentions";

import type {
  DeliveryResult,
  SushiiUpdatesRepository,
} from "../domain/SushiiUpdatesRepository";
import type { RelayTarget, UpdatePost } from "../domain/UpdatePost";
import { MAX_DELIVERY_ATTEMPTS } from "../domain/UpdatePost";
import type { SushiiUpdatesMetrics } from "../infrastructure/SushiiUpdatesMetrics";
import type { ForwardSource } from "../presentation/views/buildForwardIntro";
import {
  buildFirstForwardFooter,
  buildForwardBody,
} from "../presentation/views/buildForwardIntro";

/** A server that turns sushii updates on gets at most the last two days of posts. */
export const RELAY_WINDOW_MS = 48 * 60 * 60 * 1000;
export const POST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const STUCK_CLAIM_MIN_MS = 10 * 60 * 1000;
export const STUCK_CLAIM_MAX_MS = 6 * 60 * 60 * 1000;
export const SOURCE_PAUSE_MS = 10 * 60 * 1000;
/** About 10 sends per second per cluster. */
const DEFAULT_SEND_DELAY_MS = 100;

/** Errors from a forward that may be about the source reference rather than the target channel. */
const SOURCE_SUSPECT_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.InvalidFormBodyOrContentType,
]);

export type RelayRest = Pick<Client["rest"], "get" | "post">;

export interface RelayRunContext {
  guildIds(): string[];
  getGuild(guildId: string): Guild | undefined;
  isActive(): boolean;
}

export interface RelayOptions {
  sendDelayMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** A database failure; it ends the run instead of being logged per post. */
class RelayStoreError extends Error {}

interface DeliveryStep {
  /** A request reached Discord, so the next send waits. */
  attempted: boolean;
  /** The source post can't be forwarded right now; skip it for this run. */
  stopPost: boolean;
}

const NOT_ATTEMPTED: DeliveryStep = { attempted: false, stopPost: false };

type SourceState = "readable" | "deleted" | "unreadable";

function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) {
    return true;
  }
  if (err instanceof DiscordAPIError || err instanceof HTTPError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network failures and timeouts.
  return true;
}

function errorCode(err: unknown): string {
  if (err instanceof DiscordAPIError) {
    return String(err.code);
  }
  if (err instanceof HTTPError) {
    return `http_${err.status}`;
  }
  if (err instanceof RateLimitError) {
    return "rate_limited";
  }
  return err instanceof Error ? err.name : "error";
}

/** Forwards each captured post to every server with sushii updates on. */
export class SushiiUpdatesRelayService {
  private readonly sendDelayMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private sourceGuildId: string | null = null;
  /** Posts whose source can't be used, until a time; keeps a broken source from warning every minute. */
  private readonly pausedUntil = new Map<string, number>();
  /** At most one source lookup per post per run. */
  private sourceChecks = new Map<string, SourceState>();

  constructor(
    private readonly rest: RelayRest,
    private readonly sourceChannelId: string,
    private readonly repository: SushiiUpdatesRepository,
    private readonly metrics: SushiiUpdatesMetrics,
    private readonly commandMentions: CommandMentions,
    private readonly logger: Logger,
    options: RelayOptions = {},
  ) {
    this.sendDelayMs = options.sendDelayMs ?? DEFAULT_SEND_DELAY_MS;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => bunSleep(ms));
  }

  async run(ctx: RelayRunContext): Promise<void> {
    this.sourceChecks = new Map();
    const now = this.now().getTime();
    const posts = await this.repository.findPostsSince(
      new Date(now - RELAY_WINDOW_MS),
    );
    if (posts.length === 0) {
      return;
    }
    const guildIds = ctx.guildIds();

    for (const post of posts) {
      // A blue/green switch mid-run hands the rest to the other slot.
      if (!ctx.isActive()) {
        return;
      }
      if (this.isPaused(post.messageId, now)) {
        continue;
      }
      try {
        await this.relayPost(post, guildIds, ctx);
      } catch (err) {
        if (err instanceof RelayStoreError) {
          throw err;
        }
        this.logger.error(
          { err, messageId: post.messageId },
          "Failed to relay sushii updates post",
        );
      }
    }
  }

  /** Global cleanup; run on one cluster only. */
  async housekeeping(): Promise<void> {
    const now = this.now().getTime();
    const removed = await this.repository.deletePostsBefore(
      new Date(now - POST_RETENTION_MS),
    );
    if (removed > 0) {
      this.logger.info({ removed }, "Removed old sushii updates posts");
    }
    this.metrics.recordStuckClaims(
      await this.repository.countStuckClaims(
        new Date(now - STUCK_CLAIM_MAX_MS),
        new Date(now - STUCK_CLAIM_MIN_MS),
      ),
    );
  }

  private isPaused(postId: string, now: number): boolean {
    const until = this.pausedUntil.get(postId);
    if (until === undefined) {
      return false;
    }
    if (until > now) {
      return true;
    }
    this.pausedUntil.delete(postId);
    return false;
  }

  private pause(postId: string, reason: string, err?: unknown): void {
    this.pausedUntil.set(postId, this.now().getTime() + SOURCE_PAUSE_MS);
    this.logger.warn(
      { err, messageId: postId, reason, pauseMs: SOURCE_PAUSE_MS },
      "Pausing sushii updates post",
    );
  }

  private async relayPost(
    post: UpdatePost,
    guildIds: string[],
    ctx: RelayRunContext,
  ): Promise<void> {
    const targets = await this.store(() =>
      this.repository.findPendingTargets(post.messageId, guildIds),
    );
    if (targets.length === 0) {
      return;
    }

    let guildId: string;
    try {
      guildId = await this.getSourceGuildId();
    } catch (err) {
      this.pause(post.messageId, "source_guild_lookup_failed", err);
      return;
    }
    const source: ForwardSource = {
      guildId,
      channelId: this.sourceChannelId,
      messageId: post.messageId,
    };

    let sent = 0;
    for (const target of targets) {
      if (!ctx.isActive()) {
        return;
      }
      const guild = ctx.getGuild(target.guildId);
      if (!guild?.available) {
        continue;
      }

      const step = await this.deliver(post, source, target, guild);
      if (step.attempted) {
        sent += 1;
        await this.sleep(this.sendDelayMs);
      }
      if (step.stopPost) {
        return;
      }
    }

    this.logger.info(
      { messageId: post.messageId, targets: targets.length, attempted: sent },
      "Forwarded sushii updates post",
    );
  }

  private async deliver(
    post: UpdatePost,
    source: ForwardSource,
    target: RelayTarget,
    guild: Guild,
  ): Promise<DeliveryStep> {
    const claim = await this.store(() =>
      this.repository.claimDelivery(post.messageId, guild.id),
    );
    if (claim.kind === "post_deleted") {
      return { attempted: false, stopPost: true };
    }
    if (claim.kind === "taken") {
      return NOT_ATTEMPTED;
    }

    const problem = this.channelProblem(guild, target.channelId);
    if (problem) {
      await this.complete(post, guild.id, {
        status: "skipped",
        errorCode: problem,
      });
      return NOT_ATTEMPTED;
    }

    let forwarded: APIMessage;
    try {
      // At-least-once on timeouts: if Discord handled a request that timed out, a retry forwards again.
      forwarded = (await this.rest.post(
        Routes.channelMessages(target.channelId),
        { body: buildForwardBody(source) },
      )) as APIMessage;
    } catch (err) {
      return this.handleSendError(err, post, guild.id, claim.attempt);
    }

    await this.complete(post, guild.id, {
      status: "sent",
      messageId: forwarded.id,
    });
    if (await this.store(() => this.repository.claimIntro(guild.id))) {
      await this.sendFooter(guild.id, target.channelId);
    }
    return { attempted: true, stopPost: false };
  }

  private async handleSendError(
    err: unknown,
    post: UpdatePost,
    guildId: string,
    attempt: number,
  ): Promise<DeliveryStep> {
    const code = err instanceof DiscordAPIError ? err.code : null;
    let sourceState: SourceState = "readable";
    if (code === RESTJSONErrorCodes.CannotForwardMessageWithUnreadableContent) {
      sourceState = "unreadable";
    } else if (code !== null && SOURCE_SUSPECT_CODES.has(Number(code))) {
      // The target was checked locally, so confirm with the source before blaming it.
      sourceState = await this.checkSource(post);
    }

    if (sourceState === "deleted") {
      this.logger.info(
        { messageId: post.messageId },
        "sushii updates post was deleted, no longer forwarding it",
      );
      await this.store(() => this.repository.deletePost(post.messageId));
      return { attempted: true, stopPost: true };
    }
    if (sourceState === "unreadable") {
      await this.store(() =>
        this.repository.releaseClaim(post.messageId, guildId),
      );
      this.pause(post.messageId, "source_unreadable", err);
      return { attempted: true, stopPost: true };
    }

    const retry = isRetryable(err) && attempt < MAX_DELIVERY_ATTEMPTS;
    if (!(err instanceof DiscordAPIError) && !(err instanceof HTTPError)) {
      this.logger.warn(
        { err, guildId, messageId: post.messageId, attempt },
        "Couldn't forward sushii updates post",
      );
    }
    await this.complete(post, guildId, {
      status: retry ? "retry" : "failed",
      errorCode: errorCode(err),
    });
    return { attempted: true, stopPost: false };
  }

  private async checkSource(post: UpdatePost): Promise<SourceState> {
    const cached = this.sourceChecks.get(post.messageId);
    if (cached) {
      return cached;
    }

    let state: SourceState;
    try {
      await this.rest.get(
        Routes.channelMessage(this.sourceChannelId, post.messageId),
      );
      state = "readable";
    } catch (err) {
      state =
        err instanceof DiscordAPIError &&
        err.code === RESTJSONErrorCodes.UnknownMessage
          ? "deleted"
          : "unreadable";
    }
    this.sourceChecks.set(post.messageId, state);
    return state;
  }

  private async sendFooter(guildId: string, channelId: string): Promise<void> {
    try {
      await this.rest.post(Routes.channelMessages(channelId), {
        body: buildFirstForwardFooter(this.commandMentions.mention("settings")),
      });
    } catch (err) {
      // Best-effort and at most once: the update itself already arrived.
      this.logger.warn(
        { err, guildId, channelId },
        "Failed to send sushii updates intro",
      );
    }
  }

  private channelProblem(guild: Guild, channelId: string): string | null {
    const channel = guild.channels.cache.get(channelId);
    const me = guild.members.me;
    if (!channel || !me || !channel.isSendable()) {
      return "channel_unavailable";
    }
    const canSend = channel
      .permissionsFor(me)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]);
    return canSend ? null : "missing_permissions";
  }

  private async complete(
    post: UpdatePost,
    guildId: string,
    result: DeliveryResult,
  ): Promise<void> {
    await this.store(() =>
      this.repository.completeDelivery(post.messageId, guildId, result),
    );
    this.metrics.recordRelay(result.status);
  }

  private async getSourceGuildId(): Promise<string> {
    if (this.sourceGuildId) {
      return this.sourceGuildId;
    }
    const channel = (await this.rest.get(
      Routes.channel(this.sourceChannelId),
    )) as APIChannel;
    if (!("guild_id" in channel) || !channel.guild_id) {
      throw new Error("sushii updates channel is not in a server", {
        cause: { channelId: this.sourceChannelId },
      });
    }
    this.sourceGuildId = channel.guild_id;
    return channel.guild_id;
  }

  private async store<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new RelayStoreError("sushii updates database call failed", {
        cause: err,
      });
    }
  }
}
