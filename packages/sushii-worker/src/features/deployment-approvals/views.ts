import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  escapeMarkdown,
} from "discord.js";

import type { Candidate } from "./client";

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
export function releaseCard(card: Candidate) {
  const pending = card.phase === "pending";
  const container = new ContainerBuilder()
    .setAccentColor(
      card.phase === "succeeded" ? 0x57f287 : pending ? 0xfee75c : 0x5865f2,
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### " +
          escapeMarkdown(card.label) +
          " · " +
          escapeMarkdown(card.environment) +
          "\n" +
          "**" +
          escapeMarkdown(card.phase) +
          "** · [`" +
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
        .setLabel(
          card.phase === "deciding"
            ? "Checking approval"
            : card.phase === "stale"
              ? "Stale — review in GitHub"
              : "Release " + card.phase,
        )
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
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
            decision === "approved" ? "Approve & deploy" : "Reject release",
          )
          .setStyle(
            decision === "approved" ? ButtonStyle.Success : ButtonStyle.Danger,
          ),
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
