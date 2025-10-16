import type { APIEmbed } from "discord.js";

import type { CaseDeletionResult } from "@/features/moderation/cases/application/CaseDeletionService";
import Color from "@/utils/colors";

export function uncaseErrorView(error: string): APIEmbed {
  return {
    title: "Failed to delete cases",
    description: error,
    color: Color.Error,
  };
}

export function uncaseNoCasesView(): APIEmbed {
  return {
    title: "No cases deleted",
    description: "No cases were found in the specified range.",
    color: Color.Warning,
  };
}

export function uncaseSuccessView(
  result: CaseDeletionResult,
  keepLogMessages: boolean,
): APIEmbed {
  const caseList = formatDeletedCasesList(result);

  const fields = [
    {
      name: "Deleted Cases",
      value: caseList || "None",
      inline: false,
    },
  ];

  if (!keepLogMessages) {
    fields.push({
      name: "Log Messages Deleted",
      value:
        result.deletedMessageIds.length > 0
          ? `${result.deletedMessageIds.length} messages`
          : "No messages to delete",
      inline: false,
    });
  }

  if (result.deletedDMCount > 0) {
    fields.push({
      name: "Reason DMs Deleted",
      value: `${result.deletedDMCount} DM${result.deletedDMCount === 1 ? "" : "s"}`,
      inline: false,
    });
  }

  return {
    title: `Deleted ${result.affectedCount} case${result.affectedCount === 1 ? "" : "s"}`,
    fields,
    color: Color.Success,
  };
}

function formatDeletedCasesList(result: CaseDeletionResult): string {
  const maxDisplayCount = 25;
  const cases = result.deletedCases.slice(0, maxDisplayCount);

  const caseList = cases
    .map((case_) => `#${case_.caseId} - ${case_.actionType} <@${case_.userId}>`)
    .join("\n");

  if (result.affectedCount <= maxDisplayCount) {
    return caseList;
  }

  return `${caseList}\n... and ${result.affectedCount - maxDisplayCount} more cases`;
}
