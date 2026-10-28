import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import { match } from "path-to-regexp";

import ButtonHandler from "@/shared/presentation/handlers/ButtonHandler";

import type { ApprovalClient } from "./client";
import { ApprovalError } from "./client";
import { confirmationCard, linkCard } from "./views";

export class DeploymentApprovalButtonHandler extends ButtonHandler {
  readonly customIDMatch = match("/deploy-approval/*parts");
  constructor(
    private readonly api: ApprovalClient,
    private readonly ownerId: string,
  ) {
    super();
  }
  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!this.ownerId || interaction.user.id !== this.ownerId) {
      await interaction.reply({
        content: "Only the configured owner can review deployments.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // defer: private backend performs live GitHub checks before answering.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const parts = interaction.customId.split("/").slice(2);
    try {
      if (parts[0] === "link" && parts.length === 1) {
        const url = await this.api.link(interaction.user.id);
        await interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [
            new ContainerBuilder()
              .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                  "Open this private link while connected to Tailscale. It expires in five minutes.",
                ),
              )
              .addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel("Connect GitHub")
                    .setURL(url),
                ),
              ),
          ],
        });
      } else if (
        parts[0] === "review" &&
        parts.length === 4 &&
        /^\d+$/.test(parts[2])
      ) {
        const result = await this.api.review(
          interaction.user.id,
          parts[1],
          Number(parts[2]),
          parts[3],
        );
        await interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [
            confirmationCard(result.card, result.confirmation, parts[3]),
          ],
        });
      } else if (parts[0] === "confirm" && parts.length === 2) {
        await this.api.post("/internal/decide", {
          actor: interaction.user.id,
          confirmation: parts[1],
        });
        await interaction.editReply({
          content:
            "Decision submitted to GitHub. Deployment updates appear in the release thread.",
        });
      } else {
        await interaction.editReply({
          content:
            "This release control is invalid. Open the latest release message.",
        });
      }
    } catch (err) {
      if (!(err instanceof ApprovalError)) throw err;
      if (
        ["github_link_required", "github_authorization_required"].includes(
          err.code,
        )
      ) {
        await interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [linkCard()],
        });
      } else {
        await interaction.editReply({
          content:
            err.code === "approval_result_uncertain"
              ? "GitHub's response was uncertain. Check the workflow before trying another approval."
              : "This release cannot be approved from this control now. Open GitHub or review the latest release message.",
        });
      }
    }
  }
}
