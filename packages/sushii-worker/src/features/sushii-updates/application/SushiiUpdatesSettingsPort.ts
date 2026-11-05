import type { Guild } from "discord.js";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

export type FollowError =
  | "missing_permissions"
  /** sushii can't see the server's own channel. */
  | "channel_access"
  | "webhook_limit"
  /** The follow in the previous channel couldn't be removed. */
  | "previous_follow"
  /** sushii's own updates channel can't be followed. */
  | "unavailable";
export type UnfollowError = "missing_permissions";

export interface SushiiUpdatesSettingsState {
  following: boolean;
  /** The server turned updates off itself, in /settings or on the prompt. */
  optedOut: boolean;
  /** Whether sushii can see the notifications channel and manage its webhooks. */
  canManageWebhooks: boolean;
}

/** The notifications modal's choice, plus what the modal showed. */
export interface SushiiUpdatesSettingsInput {
  channelId: string | null;
  follow: boolean;
  previousChannelId: string | null;
  wasFollowing: boolean;
  /** The checkbox's pre-filled value. */
  shownChecked: boolean;
}

export type SushiiUpdatesSettingsOutcome =
  | { kind: "unchanged" }
  | { kind: "followed"; channelId: string }
  | { kind: "unfollowed" }
  | { kind: "follow_failed"; channelId: string; error: FollowError }
  | {
      kind: "unfollow_failed";
      channelId: string | null;
      error: UnfollowError;
    };

/** The checkbox starts ticked unless the server opted out and doesn't follow. */
export function updatesCheckboxDefault(
  state: SushiiUpdatesSettingsState,
): boolean {
  return state.following || !state.optedOut;
}

/**
 * True when applying the input likely needs Discord API calls, so the submit
 * should defer: any ticked box (the apply lists the channel's webhooks) or a
 * follow the modal showed. Based on what the modal showed; the apply re-reads the DB.
 */
export function sushiiUpdatesSyncNeeded(
  input: SushiiUpdatesSettingsInput,
): boolean {
  const target = input.follow ? input.channelId : null;
  return target !== null || input.wasFollowing;
}

export interface SushiiUpdatesSettingsPort {
  getForSettings(
    guild: Guild,
    config: GuildConfig,
  ): Promise<SushiiUpdatesSettingsState>;
  /** Call after the notifications channel itself is saved. */
  applySettings(
    guild: Guild,
    input: SushiiUpdatesSettingsInput,
  ): Promise<SushiiUpdatesSettingsOutcome>;
}
