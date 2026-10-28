import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

import type { ReasonUpdateResult } from "@/features/moderation/cases/application/ReasonUpdateService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import customIds from "@/interactions/customIds";
import Color from "@/utils/colors";

export function reasonWarningView(
  casesWithReason: ModerationCase[],
  allCasesCount: number,
  newReason: string,
  hidePartialUpdateButton: boolean,
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder> } {
  let description = `**${casesWithReason.length} / ${allCasesCount}** of specified cases already have reasons set:\n\n`;

  const caseDescriptions = casesWithReason.map((modCase) => {
    let s = `\`#${modCase.caseId}\` - **${modCase.actionType}**`;
    s += ` - <@${modCase.userId}>\n`;
    s += `┗ **Reason:** ${modCase.reason?.value || "No reason"}`;
    return s;
  });

  description += `${caseDescriptions.join("\n")}`;
  description += "\n\nPick an option below to continue or cancel.";

  const embed = new EmbedBuilder()
    .setTitle("Warning")
    .setDescription(`**New Reason**\n${newReason}\n\n${description}`)
    .setFooter({
      text: "Cancels in 2 minutes",
    })
    .setColor(Color.Warning);

  const buttons = [
    new ButtonBuilder()
      .setStyle(ButtonStyle.Danger)
      .setLabel("Overwrite all")
      .setCustomId(
        customIds.reasonConfirmButton.compile({
          userId: "0", // Placeholder - we check user in collector
          buttonId: "0", // Placeholder - we use collector instead
          action: "override",
        }),
      ),
  ];

  if (!hidePartialUpdateButton) {
    const emptyButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Primary)
      .setLabel("Set reasons for cases without reason")
      .setCustomId(
        customIds.reasonConfirmButton.compile({
          userId: "0", // Placeholder - we check user in collector
          buttonId: "0", // Placeholder - we use collector instead
          action: "empty",
        }),
      );

    buttons.push(emptyButton);
  }

  const cancelButton = new ButtonBuilder()
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Cancel")
    .setCustomId(
      customIds.reasonConfirmButton.compile({
        userId: "0", // Placeholder - we check user in collector
        buttonId: "0", // Placeholder - we use collector instead
        action: "cancel",
      }),
    );

  buttons.push(cancelButton);

  const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...buttons,
  );

  return { embed, components };
}

export function reasonSuccessView(
  result: ReasonUpdateResult,
  reason: string,
  caseRange: string,
): EmbedBuilder {
  const { updatedCases, errors } = result;

  const uniqueAffectedUserIDs = [
    ...new Set<string>(updatedCases.map((c) => c.userId)),
  ];
  const uniqueAffectedUserMentionStr = uniqueAffectedUserIDs
    .map((id) => `<@${id}>`)
    .join(", ");
  const uniqueAffectedUserIDsStr = uniqueAffectedUserIDs.join("\n");

  let affectedUsersStr = uniqueAffectedUserMentionStr;
  affectedUsersStr += "\n";
  affectedUsersStr += "User IDs:\n";
  affectedUsersStr += uniqueAffectedUserIDsStr;

  const embed = new EmbedBuilder()
    .setTitle(`Reason updated for case ${caseRange}`)
    .setDescription(`**Reason**\n${reason}`)
    .addFields([
      {
        name: "Affected user histories",
        value: affectedUsersStr,
      },
    ])
    .setColor(Color.Success);

  const dmSummary = summarizeDmUpdates(result);
  if (dmSummary) {
    embed.addFields({ name: "DM", value: dmSummary });
  }

  const modLogOff =
    errors.length > 0 && errors.every((e) => e.errorType === "not_configured");
  if (modLogOff) {
    embed.addFields({
      name: "Note",
      value:
        "Mod logs aren't set up or are turned off, so only the case was updated.",
    });
  }

  // Add error information if there were issues
  if (errors.length > 0 && !modLogOff) {
    const errorMessages = errors.map((err) => {
      switch (err.errorType) {
        case "msg_missing":
          return `Mod log message missing for case ${err.caseId}`;
        case "msg_fetch":
          return `Could not fetch mod log message for case ${err.caseId}`;
        case "not_configured":
          return err.message;
        default:
          return `Unknown error for case ${err.caseId}`;
      }
    });

    let errorNote = `I updated the reason in the users' histories, but some \
cases may not have been updated in the mod log channel. This could be due \
to the mod log channel being changed, or I don't have permission to view \
the mod log channel.`;
    errorNote += "\n\n";
    errorNote += `${errorMessages.join("\n")}`;

    embed.addFields({
      name: "Note",
      value: errorNote,
    });
  }

  return embed;
}

function summarizeDmUpdates(result: ReasonUpdateResult): string | null {
  if (result.dmUpdates.length === 0) {
    return null;
  }

  const count = (outcome: string) =>
    result.dmUpdates.filter((u) => u.outcome === outcome).length;
  const updated = count("updated");
  const noDm = count("no_dm");
  const failed = count("failed");
  const unverified = count("skipped_unverified");

  const lines: string[] = [];
  if (updated > 0) {
    lines.push(
      updated === 1
        ? "Updated the DM with the new reason."
        : `Updated ${updated} DMs with the new reason.`,
    );
  }
  if (noDm > 0) {
    lines.push(
      noDm === 1
        ? "1 case had no DM to update."
        : `${noDm} cases had no DM to update.`,
    );
  }
  if (failed > 0) {
    lines.push(
      `Couldn't update ${failed === 1 ? "1 DM" : `${failed} DMs`}: the user may have deleted it, blocked sushii or left every server with sushii.`,
    );
  }

  if (unverified > 0) {
    lines.push(
      `Didn't update ${unverified === 1 ? "1 DM" : `${unverified} DMs`}: couldn't check the mod log entry for a deleted DM first.`,
    );
  }

  return lines.join("\n");
}

export function reasonUpdatingView(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Updating reasons…")
    .setDescription("Updating the cases, their mod log entries and DMs.")
    .setColor(Color.Info);
}

export function reasonCancelledView(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Cancelled")
    .setDescription("Cancelled reason update, no cases were modified.")
    .setColor(Color.Success);
}

export function reasonExpiredView(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Confirmation Expired")
    .setDescription(
      "Reason confirmation expired. Run the `/reason` command again if you still want to update the cases.",
    )
    .setColor(Color.Error);
}

export function reasonErrorView(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Error")
    .setDescription(message)
    .setColor(Color.Error);
}

export function reasonNoCasesView(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("No cases updated")
    .setDescription("Hmm.. there weren't any cases to update.")
    .setColor(Color.Error);
}

export function reasonInvalidRangeView(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Invalid Case Range")
    .setDescription(
      "Please provide a valid case range. Examples:\n" +
        "• `123` - Single case\n" +
        "• `100-105` - Range of cases\n" +
        "• `latest` - Latest case\n" +
        "• `latest~5` - Latest 5 cases",
    )
    .setColor(Color.Error);
}
