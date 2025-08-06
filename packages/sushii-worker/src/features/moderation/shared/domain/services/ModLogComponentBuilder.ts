import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import customIds from "@/interactions/customIds";

import { ModerationCase } from "../entities/ModerationCase";
import { ActionType } from "../value-objects/ActionType";

/**
 * Domain service for building mod log message components (buttons).
 * Encapsulates the business logic for which buttons to show based on action type and DM status.
 */
export class ModLogComponentBuilder {
  constructor(
    private readonly actionType: ActionType,
    private readonly moderationCase: ModerationCase,
    private readonly dmDeleted: boolean = false,
  ) {}

  /**
   * Builds the action row components for the mod log message.
   */
  build(): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Add DM status buttons if applicable
    this.addDMStatusButtons(row);

    // Add DM error button if there was an error
    this.addDMErrorButton(row);

    // Add reason button for certain action types
    if (this.shouldShowReasonButton()) {
      this.addReasonButton(row);
    }

    return row.components.length > 0 ? [row] : [];
  }

  /**
   * Adds DM status buttons (sent/deleted) to the row.
   */
  private addDMStatusButtons(row: ActionRowBuilder<ButtonBuilder>): void {
    const dmResult = this.moderationCase.dmResult;
    if (
      !dmResult?.channelId ||
      !dmResult?.messageId ||
      !this.moderationCase.reason
    ) {
      return;
    }

    const statusEmoji = this.dmDeleted ? "🗑️" : "📬";
    const statusLabel = this.dmDeleted ? "Reason DM deleted" : "Reason DM sent";

    const dmStatusButton = new ButtonBuilder()
      .setEmoji({ name: statusEmoji })
      .setStyle(ButtonStyle.Secondary)
      .setLabel(statusLabel)
      .setCustomId("noop")
      .setDisabled(true);

    row.addComponents(dmStatusButton);

    // Only add delete button if the DM is not already deleted
    if (!this.dmDeleted) {
      const deleteDMButton = new ButtonBuilder()
        .setEmoji({ name: "🗑️" })
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Delete reason DM")
        .setCustomId(
          customIds.modLogDeleteReasonDM.compile({
            caseId: this.moderationCase.caseId,
            channelId: dmResult.channelId,
            messageId: dmResult.messageId,
          }),
        );

      row.addComponents(deleteDMButton);
    }
  }

  /**
   * Adds DM error button if there was an error sending the DM.
   */
  private addDMErrorButton(row: ActionRowBuilder<ButtonBuilder>): void {
    const dmResult = this.moderationCase.dmResult;
    if (!dmResult?.error) {
      return;
    }

    const dmFailedButton = new ButtonBuilder()
      .setEmoji({ name: "❌" })
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Reason DM failed")
      .setCustomId("noop")
      .setDisabled(true);

    row.addComponents(dmFailedButton);
  }

  /**
   * Adds the "Set reason" button for actions that support it.
   */
  private addReasonButton(row: ActionRowBuilder<ButtonBuilder>): void {
    if (this.moderationCase.reason) {
      return; // Already has reason
    }

    const reasonButton = new ButtonBuilder()
      .setEmoji({ name: "📝" })
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Set reason")
      .setCustomId(
        customIds.modLogReason.compile({
          caseId: this.moderationCase.caseId,
        }),
      );

    row.addComponents(reasonButton);
  }

  /**
   * Determines whether to show the reason button based on action type and current state.
   */
  private shouldShowReasonButton(): boolean {
    // Only show reason button for Ban and Timeout actions
    if (
      this.actionType !== ActionType.Ban &&
      this.actionType !== ActionType.Timeout
    ) {
      return false;
    }

    // Don't show if already has reason and there are DM buttons
    if (this.moderationCase.reason && this.hasDMButtons()) {
      return false;
    }

    // Show if no reason exists
    return !this.moderationCase.reason;
  }

  /**
   * Checks if there are DM-related buttons to show.
   */
  private hasDMButtons(): boolean {
    const dmResult = this.moderationCase.dmResult;
    return !!(
      dmResult?.channelId &&
      dmResult?.messageId &&
      this.moderationCase.reason
    );
  }
}
