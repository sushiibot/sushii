import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIComponentInMessageActionRow,
  APIContainerComponent,
  APIMessage,
  APITextDisplayComponent,
} from "discord-api-types/v10";
import { ComponentType } from "discord-api-types/v10";
import { MessageFlags, type ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";

/**
 * Replaces one button, matched by custom_id, with a new button in place —
 * leaving every other component (other rows, text, media) untouched.
 * Used for alert message utility buttons (e.g. remove timeout, report) that
 * shouldn't trigger a full rebuild of the moderation action row.
 */
export function replaceAlertButton(
  container: APIContainerComponent,
  customId: string,
  newButton: APIButtonComponent,
): APIContainerComponent {
  return {
    ...container,
    components: container.components.map((c) => {
      if (c.type !== ComponentType.ActionRow) {
        return c;
      }

      return {
        ...c,
        components: c.components.map((button) =>
          "custom_id" in button && button.custom_id === customId
            ? newButton
            : button,
        ),
      };
    }),
  };
}

/**
 * Replaces one alert utility button in place (e.g. to show "Reported" /
 * "Timeout Removed" after it's clicked) and edits the message. Failures are
 * logged, not thrown — the interaction itself has already been acknowledged
 * by the caller, so a failed cosmetic edit shouldn't surface as an error.
 */
export async function disableAlertButton(
  interaction: ButtonInteraction,
  newButton: APIButtonComponent,
  logger: Logger,
  logContext: Record<string, unknown>,
): Promise<void> {
  try {
    const rawMessage = interaction.message.toJSON() as APIMessage;
    const rawContainer = (rawMessage.components ?? [])[0] as
      | APIContainerComponent
      | undefined;
    if (!rawContainer) {
      return;
    }

    const updatedContainer = replaceAlertButton(rawContainer, interaction.customId, newButton);

    await interaction.message.edit({
      components: [updatedContainer],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    logger.warn(
      { err, ...logContext, messageId: interaction.message.id },
      "Failed to update alert message after button action",
    );
  }
}

function isModerationActionRow(
  row: APIActionRowComponent<APIComponentInMessageActionRow>,
): boolean {
  return row.components.some(
    (c) =>
      "custom_id" in c && customIds.automodAlertAction.match(c.custom_id) !== false,
  );
}

/**
 * Swaps out the moderation action row (Warn/Kick/Softban/Ban/…) for a new one
 * while preserving every other row on the message (e.g. the Remove Timeout /
 * Report Incorrect Detection utility row) — unlike a blanket "strip every
 * ActionRow" rebuild, which silently deletes rows it doesn't know about.
 */
export function rebuildModerationActionRow(
  container: APIContainerComponent,
  actionLine: APITextDisplayComponent,
  newModerationRow: APIActionRowComponent<APIComponentInMessageActionRow> | null,
): APIContainerComponent {
  const otherRows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];

  const withoutModRowOrOtherRows = container.components.filter((c) => {
    if (c.type !== ComponentType.ActionRow) {
      return true;
    }
    if (isModerationActionRow(c)) {
      return false;
    }
    otherRows.push(c);
    return false;
  });

  const lastChild = withoutModRowOrOtherRows[withoutModRowOrOtherRows.length - 1];
  const baseChildren =
    lastChild?.type === ComponentType.TextDisplay
      ? withoutModRowOrOtherRows.slice(0, -1)
      : withoutModRowOrOtherRows;

  return {
    ...container,
    components: [
      ...baseChildren,
      actionLine,
      ...(newModerationRow ? [newModerationRow] : []),
      ...otherRows,
    ],
  };
}

/**
 * Strips the action row from a resolved review message and appends a status
 * line — used once a report/candidate has reached a terminal state.
 */
export function stripActionRowAndAppendLine(
  container: APIContainerComponent,
  statusLine: APITextDisplayComponent,
): APIContainerComponent {
  const withoutActionRow = container.components.filter(
    (c) => c.type !== ComponentType.ActionRow,
  );

  return {
    ...container,
    components: [...withoutActionRow, statusLine],
  };
}
