import {
  CheckboxGroupBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { SettingsPatch } from "../../application/SettingsPatch";
import { settingsIds } from "../session/settingsIds";
import type { ModalContext, ModalSubmission } from "./ModalContext";
import {
  FIELD,
  checkboxLabel,
  readCheckbox,
  readText,
  textLabel,
} from "./modalFields";

export type DmTarget = "dm-timeout" | "dm-warn" | "dm-ban" | "dm-kick";

const EXTRA_TEXT_LABEL = "Extra text";
const EXTRA_TEXT_DESCRIPTION = "Added below the reason. Leave empty for none.";

const TIMEOUT_SOURCE = {
  command: "command",
  native: "native",
} as const;

function buildTimeoutModal(ctx: ModalContext): ModalBuilder {
  const settings = ctx.config.moderationSettings;
  return new ModalBuilder()
    .setCustomId(settingsIds.modal("dm-timeout"))
    .setTitle("Timeout DM")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Send a DM when timing out with")
        .setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId(FIELD.sources)
            .setMinValues(0)
            .setMaxValues(2)
            .setRequired(false)
            .addOptions(
              {
                value: TIMEOUT_SOURCE.command,
                label: "/timeout",
                default: settings.timeoutCommandDmEnabled,
              },
              {
                value: TIMEOUT_SOURCE.native,
                label: "Right-click → Timeout",
                default: settings.timeoutNativeDmEnabled,
              },
            ),
        ),
      textLabel({
        label: EXTRA_TEXT_LABEL,
        description: EXTRA_TEXT_DESCRIPTION,
        current: settings.timeoutDmText,
      }),
    );
}

function buildWarnModal(ctx: ModalContext): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(settingsIds.modal("dm-warn"))
    .setTitle("Warn DM")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Warn DMs are always sent."),
    )
    .addLabelComponents(
      textLabel({
        label: EXTRA_TEXT_LABEL,
        description: EXTRA_TEXT_DESCRIPTION,
        current: ctx.config.moderationSettings.warnDmText,
      }),
    );
}

function buildBanModal(ctx: ModalContext): ModalBuilder {
  const settings = ctx.config.moderationSettings;
  return new ModalBuilder()
    .setCustomId(settingsIds.modal("dm-ban"))
    .setTitle("Ban DM")
    .addLabelComponents(
      checkboxLabel({
        label: "Send a DM when banning with /ban",
        description: "Right-click bans can't send DMs",
        customId: FIELD.enabled,
        checked: settings.banDmEnabled,
      }),
      textLabel({
        label: EXTRA_TEXT_LABEL,
        description:
          "Added below the reason, e.g. appeal links. Leave empty for none.",
        current: settings.banDmText,
      }),
    );
}

function buildKickModal(ctx: ModalContext): ModalBuilder {
  const settings = ctx.config.moderationSettings;
  return new ModalBuilder()
    .setCustomId(settingsIds.modal("dm-kick"))
    .setTitle("Kick DM")
    .addLabelComponents(
      checkboxLabel({
        label: "Send a DM when kicking with /kick",
        description: "Right-click kicks can't send DMs",
        customId: FIELD.enabled,
        checked: settings.kickDmEnabled,
      }),
      textLabel({
        label: EXTRA_TEXT_LABEL,
        description: EXTRA_TEXT_DESCRIPTION,
        current: settings.kickDmText,
      }),
    );
}

export function buildDmModal(
  target: DmTarget,
  ctx: ModalContext,
): ModalBuilder {
  switch (target) {
    case "dm-timeout":
      return buildTimeoutModal(ctx);
    case "dm-warn":
      return buildWarnModal(ctx);
    case "dm-ban":
      return buildBanModal(ctx);
    case "dm-kick":
      return buildKickModal(ctx);
  }
}

export function parseDmModal(
  target: DmTarget,
  submission: ModalSubmission,
): SettingsPatch[] {
  const text = readText(submission);

  switch (target) {
    case "dm-timeout": {
      const sources = submission.fields.getCheckboxGroup(FIELD.sources);
      return [
        {
          kind: "timeoutDm",
          commandEnabled: sources.includes(TIMEOUT_SOURCE.command),
          nativeEnabled: sources.includes(TIMEOUT_SOURCE.native),
          text,
        },
      ];
    }
    case "dm-warn":
      return [{ kind: "warnDm", text }];
    case "dm-ban":
      return [
        {
          kind: "banDm",
          enabled: readCheckbox(submission, FIELD.enabled),
          text,
        },
      ];
    case "dm-kick":
      return [
        {
          kind: "kickDm",
          enabled: readCheckbox(submission, FIELD.enabled),
          text,
        },
      ];
  }
}
