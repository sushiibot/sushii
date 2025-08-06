import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

import { ReasonUpdateResult } from "@/features/moderation/cases/application/ReasonUpdateService";
import customIds from "@/interactions/customIds";
import Color from "@/utils/colors";

import { ModerationCase } from "../../../shared/domain/entities/ModerationCase";

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
    .setDescription(description)
    .setFields({
      name: "New Reason",
      value: newReason,
    })
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
    .addFields([
      {
        name: "Reason",
        value: reason,
      },
      {
        name: "Affected user histories",
        value: affectedUsersStr,
      },
    ])
    .setColor(Color.Success);

  // Add error information if there were issues
  if (errors.length > 0) {
    const errorMessages = errors.map((err) => {
      switch (err.errorType) {
        case "user_fetch":
          return `Could not fetch user for case ${err.caseId}`;
        case "msg_missing":
          return `Mod log message missing for case ${err.caseId}`;
        case "msg_fetch":
          return `Could not fetch mod log message for case ${err.caseId}`;
        case "permission":
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
