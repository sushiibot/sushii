import type { ButtonBuilder } from "discord.js";
import { ActionRowBuilder } from "discord.js";

import type { SushiiNotification } from "@/shared/infrastructure/SushiiNotificationService";
import { buildSupportServerButton } from "@/shared/presentation/supportServer";

import type {
  FollowError,
  SushiiUpdatesSettingsOutcome,
  UnfollowError,
} from "../application/SushiiUpdatesSettingsPort";

export function followErrorText(error: FollowError, channelId: string): string {
  switch (error) {
    case "missing_permissions":
      return `sushii needs **Manage Webhooks** in <#${channelId}> to post updates there.`;
    case "channel_access":
      return `sushii can't see <#${channelId}>. Give it **View Channel** and **Manage Webhooks** there, then try again.`;
    case "webhook_limit":
      return `<#${channelId}> already has as many webhooks as Discord allows. Remove one, then try again.`;
    case "previous_follow":
      return "sushii couldn't remove its updates follow from the previous channel. Give it **Manage Webhooks** there, or remove the follow in that channel's Integrations settings, then try again.";
    case "unavailable":
      return "sushii's updates channel isn't available right now. Try again later.";
  }
}

export function savedButNotFollowingText(channelId: string): string {
  return `<#${channelId}> is saved as your sushii notifications channel, but it doesn't get sushii updates yet.`;
}

export function unfollowErrorText(
  error: UnfollowError,
  channelId: string | null,
): string {
  switch (error) {
    case "missing_permissions": {
      const where = channelId ? ` in <#${channelId}>` : "";
      return `sushii needs **Manage Webhooks**${where} to stop posting sushii updates there. Give it that permission and try again, or remove the follow in the channel's Integrations settings.`;
    }
  }
}

/** Shown after a notifications modal submit; null when there's nothing to report. */
export function settingsOutcomeText(
  outcome: SushiiUpdatesSettingsOutcome,
): string | null {
  switch (outcome.kind) {
    case "follow_failed":
      return `${savedButNotFollowingText(outcome.channelId)} ${followErrorText(outcome.error, outcome.channelId)}`;
    case "unfollow_failed":
      return unfollowErrorText(outcome.error, outcome.channelId);
    default:
      return null;
  }
}

export const BACKFILL_NOTICE: SushiiNotification = {
  title: "📢 sushii updates now post here",
  body: "This channel already gets alerts when something in your server needs fixing. It now also gets sushii updates about new features, so you don't need to join the support server to hear about them.",
  hint: "Don't want them? Turn off **Also post sushii updates here** in /settings → Logging → sushii notifications.",
  severity: "info",
  buttons: new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildSupportServerButton("Join the support server"),
  ),
};
