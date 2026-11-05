import type {
  APIChannel,
  APIWebhook,
  Client,
  Guild,
  RESTPostAPIChannelFollowersJSONBody,
  RESTPostAPIChannelFollowersResult,
} from "discord.js";
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  WebhookType,
} from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { SushiiUpdatesRepository } from "../domain/SushiiUpdatesRepository";
import type {
  FollowSource,
  SushiiUpdatesMetrics,
} from "../infrastructure/SushiiUpdatesMetrics";
import type {
  FollowError,
  SushiiUpdatesSettingsInput,
  SushiiUpdatesSettingsOutcome,
  SushiiUpdatesSettingsPort,
  SushiiUpdatesSettingsState,
  UnfollowError,
} from "./SushiiUpdatesSettingsPort";

export type UpdatesRest = Pick<Client["rest"], "get" | "post" | "delete">;

export interface FollowSuccess {
  webhookId: string;
  /** The channel already followed sushii's updates channel. */
  alreadyFollowing: boolean;
}

/** A server's explicit "no" to sushii updates, stored as the prompt's dismissal. */
/** Discord allows at most 15 webhooks per channel. */
const CHANNEL_WEBHOOK_LIMIT = 15;

export interface UpdatesOptOut {
  record(guildId: string): Promise<void>;
  isOptedOut(guildId: string): Promise<boolean>;
}

function apiErrorCode(err: unknown): number | string | null {
  return err instanceof DiscordAPIError ? err.code : null;
}

export function canManageWebhooksIn(guild: Guild, channelId: string): boolean {
  const channel = guild.channels.cache.get(channelId);
  const me = guild.members.me;
  if (!channel || !me) {
    return false;
  }
  return (
    channel
      .permissionsFor(me)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageWebhooks,
      ]) ?? false
  );
}

export class SushiiUpdatesService implements SushiiUpdatesSettingsPort {
  // One follow change per guild at a time, so a double click or a prompt racing the backfill can't create two followers.
  private readonly guildLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly rest: UpdatesRest,
    private readonly sourceChannelId: string,
    private readonly repository: SushiiUpdatesRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly metrics: SushiiUpdatesMetrics,
    private readonly optOut: UpdatesOptOut,
    private readonly logger: Logger,
  ) {}

  /** Follows into `channelId`, moving an existing follow from another channel. */
  async follow(
    guild: Guild,
    channelId: string,
    source: FollowSource,
  ): Promise<Result<FollowSuccess, FollowError>> {
    return this.withGuildLock(guild.id, () =>
      this.followUnlocked(guild, channelId, source),
    );
  }

  /** Ok(false) when there was nothing to remove. */
  async unfollow(
    guild: Guild,
    source: FollowSource,
  ): Promise<Result<boolean, UnfollowError>> {
    return this.withGuildLock(guild.id, async () => {
      await this.repository.markDecided(guild.id);
      return this.unfollowUnlocked(guild, source);
    });
  }

  /** Whether sushii's updates channel exists, is visible and can be followed. */
  async sourceAvailable(): Promise<boolean> {
    let channel: APIChannel;
    try {
      channel = (await this.rest.get(
        Routes.channel(this.sourceChannelId),
      )) as APIChannel;
    } catch (err) {
      if (!(err instanceof DiscordAPIError)) {
        throw err;
      }
      this.logger.warn(
        { err, sourceChannelId: this.sourceChannelId },
        "sushii updates channel is unavailable",
      );
      return false;
    }

    if (channel.type !== ChannelType.GuildAnnouncement) {
      this.logger.warn(
        { sourceChannelId: this.sourceChannelId, type: channel.type },
        "sushii updates channel is not an announcement channel",
      );
      return false;
    }
    return true;
  }

  async getForSettings(
    guild: Guild,
    config: GuildConfig,
  ): Promise<SushiiUpdatesSettingsState> {
    const channelId = config.loggingSettings.sushiiNotificationsChannel;
    const following = config.loggingSettings.sushiiUpdatesWebhookId !== null;
    return {
      following,
      optedOut: !following && (await this.optOut.isOptedOut(guild.id)),
      canManageWebhooks:
        channelId !== null && canManageWebhooksIn(guild, channelId),
    };
  }

  async applySettings(
    guild: Guild,
    input: SushiiUpdatesSettingsInput,
  ): Promise<SushiiUpdatesSettingsOutcome> {
    return this.withGuildLock(guild.id, async () => {
      const target = input.follow ? input.channelId : null;
      // Only unticking a box the user saw ticked is an opt-out.
      if (!input.follow && input.shownChecked) {
        await this.repository.markDecided(guild.id);
        await this.optOut.record(guild.id);
      }

      const stored = await this.storedWebhookId(guild.id);
      if (!target) {
        if (!stored) {
          return { kind: "unchanged" };
        }
        const unfollowed = await this.unfollowUnlocked(guild, "settings");
        if (unfollowed.err) {
          return {
            kind: "unfollow_failed",
            channelId: input.previousChannelId,
            error: unfollowed.val,
          };
        }
        return { kind: "unfollowed" };
      }

      const followed = await this.followUnlocked(guild, target, "settings");
      if (followed.err) {
        return {
          kind: "follow_failed",
          channelId: target,
          error: followed.val,
        };
      }
      if (followed.val.alreadyFollowing && stored === followed.val.webhookId) {
        return { kind: "unchanged" };
      }
      return { kind: "followed", channelId: target };
    });
  }

  private async followUnlocked(
    guild: Guild,
    channelId: string,
    source: FollowSource,
  ): Promise<Result<FollowSuccess, FollowError>> {
    if (source !== "backfill") {
      await this.repository.markDecided(guild.id);
    }

    const stored = await this.storedWebhookId(guild.id);
    const followers = await this.listFollowers(channelId);
    if (followers.err) {
      return this.followFailed(guild, channelId, source, followers.val);
    }

    const { followers: existingFollowers, total } = followers.val;
    if (stored && existingFollowers.includes(stored)) {
      this.metrics.recordFollow(source, "already_following");
      return Ok({ webhookId: stored, alreadyFollowing: true });
    }

    // Checked before removing the old follow so a move into a full channel doesn't leave the server following nowhere.
    if (existingFollowers.length === 0 && total >= CHANNEL_WEBHOOK_LIMIT) {
      return this.followFailed(guild, channelId, source, "webhook_limit");
    }

    if (stored) {
      const removed = await this.unfollowUnlocked(guild, source);
      if (removed.err) {
        return this.followFailed(guild, channelId, source, "previous_follow");
      }
    }

    // A follow the server set up itself is reused instead of adding a second webhook.
    const existing = existingFollowers[0];
    if (existing) {
      await this.repository.setWebhookId(guild.id, existing);
      this.metrics.recordFollow(source, "already_following");
      return Ok({ webhookId: existing, alreadyFollowing: true });
    }

    let created: RESTPostAPIChannelFollowersResult;
    try {
      const body: RESTPostAPIChannelFollowersJSONBody = {
        webhook_channel_id: channelId,
      };
      created = (await this.rest.post(
        Routes.channelFollowers(this.sourceChannelId),
        { body },
      )) as RESTPostAPIChannelFollowersResult;
    } catch (err) {
      const error = this.createErrorFor(err);
      if (!error) {
        throw new Error("Failed to follow sushii updates", { cause: err });
      }
      return this.followFailed(guild, channelId, source, error);
    }

    await this.repository.setWebhookId(guild.id, created.webhook_id);
    this.metrics.recordFollow(source, "followed");
    this.logger.info(
      { guildId: guild.id, channelId, source },
      "Followed sushii updates",
    );
    return Ok({ webhookId: created.webhook_id, alreadyFollowing: false });
  }

  private async unfollowUnlocked(
    guild: Guild,
    source: FollowSource,
  ): Promise<Result<boolean, UnfollowError>> {
    const webhookId = await this.storedWebhookId(guild.id);
    if (!webhookId) {
      return Ok(false);
    }

    try {
      await this.rest.delete(Routes.webhook(webhookId));
    } catch (err) {
      const code = apiErrorCode(err);
      if (
        code === RESTJSONErrorCodes.MissingPermissions ||
        code === RESTJSONErrorCodes.MissingAccess
      ) {
        // Keep the ID: the follow still posts, so the panel must not claim it's off.
        return Err("missing_permissions");
      }
      if (code !== RESTJSONErrorCodes.UnknownWebhook) {
        throw new Error("Failed to unfollow sushii updates", { cause: err });
      }
    }

    await this.repository.setWebhookId(guild.id, null);
    this.metrics.recordUnfollow(source);
    this.logger.info(
      { guildId: guild.id, source },
      "Unfollowed sushii updates",
    );
    return Ok(true);
  }

  private followFailed(
    guild: Guild,
    channelId: string,
    source: FollowSource,
    error: FollowError,
  ): Result<never, FollowError> {
    this.metrics.recordFollow(source, error);
    this.logger.info(
      { guildId: guild.id, channelId, source, error },
      "Couldn't follow sushii updates",
    );
    return Err(error);
  }

  /** The target channel was listed just before, so access errors here are about the source channel. */
  private createErrorFor(err: unknown): FollowError | null {
    switch (apiErrorCode(err)) {
      case RESTJSONErrorCodes.MissingPermissions:
        return "missing_permissions";
      case RESTJSONErrorCodes.MaximumNumberOfWebhooksReached:
        return "webhook_limit";
      case RESTJSONErrorCodes.UnknownChannel:
      case RESTJSONErrorCodes.MissingAccess:
        return "unavailable";
      default:
        return null;
    }
  }

  /** IDs of webhooks in the channel that already follow sushii's updates channel. */
  private async listFollowers(
    channelId: string,
  ): Promise<Result<{ followers: string[]; total: number }, FollowError>> {
    let webhooks: APIWebhook[];
    try {
      webhooks = (await this.rest.get(
        Routes.channelWebhooks(channelId),
      )) as APIWebhook[];
    } catch (err) {
      switch (apiErrorCode(err)) {
        case RESTJSONErrorCodes.MissingPermissions:
          return Err("missing_permissions");
        case RESTJSONErrorCodes.MissingAccess:
        case RESTJSONErrorCodes.UnknownChannel:
          return Err("channel_access");
        default:
          throw new Error("Failed to list channel webhooks", { cause: err });
      }
    }

    return Ok({
      followers: webhooks
        .filter(
          (webhook) =>
            webhook.type === WebhookType.ChannelFollower &&
            webhook.source_channel?.id === this.sourceChannelId,
        )
        .map((webhook) => webhook.id),
      total: webhooks.length,
    });
  }

  private async storedWebhookId(guildId: string): Promise<string | null> {
    const config = await this.guildConfigRepository.findByGuildId(guildId);
    return config.loggingSettings.sushiiUpdatesWebhookId;
  }

  private async withGuildLock<T>(
    guildId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.guildLocks.get(guildId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.guildLocks.set(guildId, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.guildLocks.get(guildId) === tail) {
        this.guildLocks.delete(guildId);
      }
    }
  }
}
