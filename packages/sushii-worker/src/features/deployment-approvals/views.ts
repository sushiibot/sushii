import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  escapeMarkdown,
} from "discord.js";

import Color from "@/utils/colors";

import type { Candidate } from "./client";

export const STATUS_EMOJI_NAMES = [
  "schedule",
  "gear",
  "success",
  "fail",
  "warning",
  "disabled",
] as const;
export type StatusEmojis = Record<(typeof STATUS_EMOJI_NAMES)[number], string>;
const statusStyles = {
  pending: {
    title: "Awaiting approval",
    color: Color.Warning,
    emoji: "schedule",
  },
  deciding: { title: "Checking approval", color: Color.Info, emoji: "gear" },
  approved: { title: "Approved", color: Color.Info, emoji: "success" },
  deploying: { title: "Deploying", color: Color.Info, emoji: "gear" },
  succeeded: { title: "Deployed", color: Color.Success, emoji: "success" },
  failed: { title: "Deployment failed", color: Color.Error, emoji: "fail" },
  rejected: { title: "Rejected", color: Color.Error, emoji: "fail" },
  cancelled: {
    title: "Cancelled",
    color: Color.DiscordGrey,
    emoji: "disabled",
  },
  stale: { title: "Stale", color: Color.DiscordGrey, emoji: "warning" },
} as const;
function statusHeading(card: Candidate, emojis: Partial<StatusEmojis>) {
  const style = statusStyles[card.phase];
  const title = card.replacedBy ? "Replaced" : style.title;
  return `${emojis[style.emoji] ?? ""} **${title}**`.trim();
}
function closedLabel(card: Candidate): string {
  if (card.replacedBy) {
    return "Replaced by a newer message";
  }
  if (card.phase === "deciding") {
    return "Checking approval";
  }
  if (card.phase === "stale") {
    return "Stale — review in GitHub";
  }
  return "Release " + card.phase;
}
// Automatic targets have no gate to check, and a replaced card must stay inert.
function canRefresh(card: Candidate): boolean {
  return (
    typeof card.environmentId === "number" &&
    !card.replacedBy &&
    !["deciding", "approved", "deploying"].includes(card.phase)
  );
}
export function statusReply(
  card: Candidate,
  emojis: Partial<StatusEmojis> = {},
) {
  return {
    content: `${statusHeading(card, emojis)} · ${escapeMarkdown(card.detail)}\n[Deployment workflow](${runUrl(card)}/attempts/${card.runAttempt})`,
    allowed_mentions: { parse: [] },
  };
}
export function matchesStatusReply(content: string, card: Candidate): boolean {
  const current =
    content.includes(`**${statusStyles[card.phase].title}**`) &&
    content.includes(`](${runUrl(card)}/attempts/${card.runAttempt})`);
  // Old replies had no attempt identifier; only recover them for the first attempt.
  const legacy =
    card.runAttempt === 1 &&
    content.startsWith(`**${card.phase}** · `) &&
    content.includes(`](${runUrl(card)})`);
  return current || legacy;
}
export function runUrl(card: Candidate): string {
  return (
    "https://github.com/" + card.repository + "/actions/runs/" + card.runId
  );
}
export function comparisonText(card: Candidate): string {
  if (!card.previousSha) return "Previous deployed commit is not recorded.";
  return (
    "Changes: [`" +
    card.previousSha.slice(0, 7) +
    " → " +
    card.sha.slice(0, 7) +
    "`](https://github.com/" +
    card.repository +
    "/compare/" +
    card.previousSha +
    "..." +
    card.sha +
    ")"
  );
}
export function releaseCard(
  card: Candidate,
  emojis: Partial<StatusEmojis> = {},
) {
  const pending = card.phase === "pending";
  const container = new ContainerBuilder()
    .setAccentColor(statusStyles[card.phase].color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### " +
          escapeMarkdown(card.label) +
          " · " +
          escapeMarkdown(card.environment) +
          "\n" +
          statusHeading(card, emojis) +
          " · [`" +
          card.sha.slice(0, 7) +
          "`](" +
          "https://github.com/" +
          card.repository +
          "/commit/" +
          card.sha +
          ")\n" +
          comparisonText(card) +
          "\n" +
          escapeMarkdown(card.detail),
      ),
    );
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pending) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          "/deploy-approval/review/" +
            card.id +
            "/" +
            card.revision +
            "/approved",
        )
        .setLabel("Review & approve")
        .setStyle(ButtonStyle.Success),
    );
  }
  if (!pending)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("/deploy-approval/closed/" + card.id)
        .setLabel(closedLabel(card))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  if (canRefresh(card)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("/deploy-approval/refresh/" + card.id)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setLabel("Open in GitHub")
      .setStyle(ButtonStyle.Link)
      .setURL(runUrl(card)),
  );
  container.addActionRowComponents(row);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container.toJSON()],
    allowed_mentions: { parse: [] },
  };
}
export function confirmationCard(
  card: Candidate,
  token: string,
  decision: string,
  submitting = false,
) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### " +
          (decision === "approved"
            ? "Approve deployment?"
            : "Reject deployment?") +
          "\n" +
          escapeMarkdown(card.repository) +
          " · " +
          escapeMarkdown(card.environment) +
          "\n" +
          "Commit: `" +
          card.sha +
          "`\nRun: [" +
          card.runId +
          "](" +
          runUrl(card) +
          ")\n" +
          comparisonText(card) +
          "\n\n" +
          "This confirmation expires in two minutes. A replacement release requires a new review.",
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("/deploy-approval/confirm/" + token)
          .setLabel(
            submitting
              ? "Submitting…"
              : decision === "approved"
                ? "Approve & deploy"
                : "Reject release",
          )
          .setStyle(
            decision === "approved" ? ButtonStyle.Success : ButtonStyle.Danger,
          )
          .setDisabled(submitting),
        new ButtonBuilder()
          .setCustomId("/deploy-approval/cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(submitting),
      ),
    );
}
export function linkCard() {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "Link your GitHub account before approving here. You can also approve directly in GitHub.",
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("/deploy-approval/link")
          .setLabel("Link GitHub")
          .setStyle(ButtonStyle.Primary),
      ),
    );
}
