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

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import ButtonHandler from "@/shared/presentation/handlers/ButtonHandler";

import type { ApprovalClient, Candidate, RefreshOutcome } from "./client";
import { ApprovalError } from "./client";
import {
  STATUS_EMOJI_NAMES,
  confirmationCard,
  linkCard,
  releaseCard,
} from "./views";

interface OpenReview {
  card: Candidate;
  token: string;
  decision: string;
}

// Outlives the backend's two-minute confirmation so an expired click can still restore the card.
const REVIEW_TTL_MS = 5 * 60 * 1000;

const FAILURE_NOTICES: Record<string, string> = {
  approval_result_uncertain:
    "GitHub's response was uncertain. Check the workflow before trying another approval.",
  github_read_failed: "Couldn't read GitHub. Try again in a moment.",
  release_superseded:
    "Newer commits landed after this message. Use Refresh to post the latest release.",
};

const REFRESH_NOTICES: Record<RefreshOutcome, string> = {
  posted: "Posted a new approval message for the latest commit.",
  current: "The latest commit already has an approval message.",
  waiting:
    "The latest commit isn't waiting for approval. It may still be building or deploying, or it didn't start a release.",
};

export class DeploymentApprovalButtonHandler extends ButtonHandler {
  readonly customIDMatch = match("/deploy-approval/*parts");
  // Keyed by release message ID: the release card the confirmation view replaced.
  private readonly reviews = new Map<string, OpenReview>();

  constructor(
    private readonly api: ApprovalClient,
    private readonly ownerId: string,
    private readonly emojiRepo: BotEmojiRepository,
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
    const parts = interaction.customId.split("/").slice(2);
    try {
      if (parts[0] === "link" && parts.length === 1) {
        await this.link(interaction);
      } else if (
        parts[0] === "review" &&
        parts.length === 4 &&
        /^\d+$/.test(parts[2])
      ) {
        await this.review(interaction, parts[1], Number(parts[2]), parts[3]);
      } else if (parts[0] === "refresh" && parts.length === 2) {
        await this.refresh(interaction, parts[1]);
      } else if (parts[0] === "confirm" && parts.length === 2) {
        await this.confirm(interaction, parts[1]);
      } else if (parts[0] === "cancel" && parts.length === 1) {
        await this.cancel(interaction);
      } else {
        await this.notice(
          interaction,
          "This release control is invalid. Open the latest release message.",
        );
      }
    } catch (err) {
      if (!(err instanceof ApprovalError)) {
        throw err;
      }
      if (
        ["github_link_required", "github_authorization_required"].includes(
          err.code,
        )
      ) {
        await interaction.followUp({
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          components: [linkCard()],
        });
      } else {
        await this.notice(
          interaction,
          FAILURE_NOTICES[err.code] ??
            "This release cannot be approved from this control now. Open GitHub or review the latest release message.",
        );
      }
    }
  }

  private async link(interaction: ButtonInteraction) {
    // defer: private backend mints the OAuth link before answering.
    await interaction.deferUpdate();
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
  }

  private async refresh(interaction: ButtonInteraction, id: string) {
    // defer: private backend reads the branch head and gate from GitHub before answering.
    await interaction.deferUpdate();
    const outcome = await this.api.refresh(interaction.user.id, id);
    await this.notice(interaction, REFRESH_NOTICES[outcome]);
  }

  private async review(
    interaction: ButtonInteraction,
    id: string,
    revision: number,
    decision: string,
  ) {
    // defer: private backend performs live GitHub checks before answering.
    await interaction.deferUpdate();
    const result = await this.api.review(
      interaction.user.id,
      id,
      revision,
      decision,
    );
    const messageId = interaction.message.id;
    this.reviews.set(messageId, {
      card: result.card,
      token: result.confirmation,
      decision,
    });
    setTimeout(() => {
      if (this.reviews.get(messageId)?.token === result.confirmation) {
        this.reviews.delete(messageId);
      }
    }, REVIEW_TTL_MS);
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        confirmationCard(result.card, result.confirmation, decision),
      ],
    });
  }

  private async confirm(interaction: ButtonInteraction, token: string) {
    const open = this.reviews.get(interaction.message.id);
    // The publisher edits this message to "deciding" once the backend claims the
    // confirmation, so the submitting state must be sent before calling decide.
    await interaction.update({
      flags: MessageFlags.IsComponentsV2,
      components: [
        open
          ? confirmationCard(open.card, open.token, open.decision, true)
          : new ContainerBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent("Submitting decision…"),
            ),
      ],
    });
    try {
      await this.api.post("/internal/decide", {
        actor: interaction.user.id,
        confirmation: token,
      });
    } catch (err) {
      // Every other failure moves the card, and the publisher re-renders it.
      if (err instanceof ApprovalError && err.code === "confirmation_expired") {
        await this.restore(interaction);
        await this.notice(
          interaction,
          "This confirmation expired. Review the release again.",
        );
        return;
      }
      throw err;
    } finally {
      this.reviews.delete(interaction.message.id);
    }
  }

  private async cancel(interaction: ButtonInteraction) {
    const open = this.reviews.get(interaction.message.id);
    this.reviews.delete(interaction.message.id);
    if (!open) {
      await this.notice(
        interaction,
        "This confirmation is no longer tracked. The release card refreshes on its next update.",
      );
      return;
    }
    await interaction.update(await this.releaseMessage(open.card));
  }

  private async restore(interaction: ButtonInteraction) {
    const open = this.reviews.get(interaction.message.id);
    if (!open) {
      return;
    }
    await interaction.editReply(await this.releaseMessage(open.card));
  }

  private async releaseMessage(card: Candidate) {
    const emojis = await this.emojiRepo.getEmojis(STATUS_EMOJI_NAMES);
    return {
      flags: MessageFlags.IsComponentsV2 as const,
      components: releaseCard(card, emojis).components,
      allowedMentions: { parse: [] },
    };
  }

  private async notice(interaction: ButtonInteraction, content: string) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }
}
