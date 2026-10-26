import {
  ComponentType,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
} from "discord.js";

import { MAX_AUTOMOD_EXEMPT_ROLES } from "@/shared/domain/entities/GuildConfig";

import type { SettingsPatch } from "../../application/SettingsPatch";
import { settingsIds } from "../session/settingsIds";
import type { ModalContext, ModalSubmission } from "./ModalContext";
import {
  FIELD,
  channelHint,
  channelSelectLabel,
  checkboxLabel,
  missingChannelHint,
  prefillChannel,
  readChannel,
  readCheckbox,
  readSelectValues,
} from "./modalFields";

export type AutomodTarget = "exempt" | "alerts" | "screening";

function buildExemptModal(ctx: ModalContext): ModalBuilder {
  const select = new RoleSelectMenuBuilder()
    .setCustomId(FIELD.roles)
    .setMinValues(0)
    .setMaxValues(MAX_AUTOMOD_EXEMPT_ROLES)
    .setRequired(false);

  if (ctx.prefilledExemptRoleIds.length > 0) {
    select.setDefaultRoles(ctx.prefilledExemptRoleIds);
  }

  return new ModalBuilder()
    .setCustomId(settingsIds.modal("exempt"))
    .setTitle("Exempt roles")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Roles")
        .setDescription("Skipped by scam images and spam")
        .setRoleSelectMenuComponent(select),
    );
}

function buildAlertsModal(ctx: ModalContext): ModalBuilder {
  const state = ctx.status.automod.alerts;
  const channelId = prefillChannel(
    state,
    ctx.config.moderationSettings.automodAlertsChannelId,
  );

  return new ModalBuilder()
    .setCustomId(settingsIds.modal("alerts"))
    .setTitle("Automod alerts")
    .addLabelComponents(
      channelSelectLabel({
        label: "Channel",
        description: `Where automod alerts are posted. ${
          missingChannelHint(state, channelId) ?? "Leave empty for no alerts."
        }`,
        defaults: channelId ? [channelId] : [],
      }),
    );
}

function buildScreeningModal(ctx: ModalContext): ModalBuilder {
  if (!ctx.screening) {
    throw new Error("Screening modal requested without screening settings");
  }

  const state = ctx.status.automod.screening;
  const channelId = prefillChannel(state, ctx.screening.logChannelId);

  return new ModalBuilder()
    .setCustomId(settingsIds.modal("screening"))
    .setTitle("Member screening")
    .addLabelComponents(
      channelSelectLabel({
        label: "Review channel",
        description: `Where new members are posted for review. ${channelHint(state, channelId)}`,
        defaults: channelId ? [channelId] : [],
      }),
      checkboxLabel({
        label: "Check profile pictures",
        customId: FIELD.avatars,
        checked: ctx.screening.checkAvatars,
      }),
    );
}

export function buildAutomodModal(
  target: AutomodTarget,
  ctx: ModalContext,
): ModalBuilder {
  switch (target) {
    case "exempt":
      return buildExemptModal(ctx);
    case "alerts":
      return buildAlertsModal(ctx);
    case "screening":
      return buildScreeningModal(ctx);
  }
}

export function parseAutomodModal(
  target: AutomodTarget,
  submission: ModalSubmission,
): SettingsPatch[] {
  switch (target) {
    case "exempt":
      return [
        {
          kind: "automodExemptRoles",
          roleIds: readSelectValues(
            submission,
            FIELD.roles,
            ComponentType.RoleSelect,
          ),
        },
      ];
    case "alerts":
      return [
        { kind: "automodAlertsChannel", channelId: readChannel(submission) },
      ];
    case "screening":
      return [
        {
          kind: "screening",
          channelId: readChannel(submission),
          checkAvatars: readCheckbox(submission, FIELD.avatars),
        },
      ];
  }
}
