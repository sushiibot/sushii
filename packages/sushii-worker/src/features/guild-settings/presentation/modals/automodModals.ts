import {
  ComponentType,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";

import {
  IP_GRABBER_PROVIDERS,
  IP_GRABBER_PROVIDER_IDS,
} from "@/features/ip-grabber-links/domain/providers";
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

export type AutomodTarget = "exempt" | "alerts" | "screening" | "ip-grabbers";

const RULE_OFF = "off";
// One option is taken by Off.
const MAX_RULE_OPTIONS = 24;

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

function buildIpGrabbersModal(ctx: ModalContext): ModalBuilder {
  if (!ctx.ipGrabbers) {
    throw new Error("IP grabber modal requested without IP grabber settings");
  }
  const state = ctx.ipGrabbers;
  const rules = state.rules.slice(0, MAX_RULE_OPTIONS);
  // A rule cut off by the option limit stays selectable so a submit doesn't turn it off.
  if (state.ruleId && !rules.some((rule) => rule.id === state.ruleId)) {
    rules.unshift({
      id: state.ruleId,
      name: state.ruleName ?? "Current rule",
      keywordCount: state.keywordCount,
    });
    rules.splice(MAX_RULE_OPTIONS);
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(FIELD.rule)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      {
        label: "Off",
        value: RULE_OFF,
        description: "Removes the keywords sushii added",
        default: !state.ruleId,
      },
      ...rules.map((rule) => ({
        label: rule.name.slice(0, 100),
        value: rule.id,
        description: `${rule.keywordCount} keywords`,
        default: rule.id === state.ruleId,
      })),
    );

  // New setups start with every provider on.
  const enabled =
    state.ruleId || state.providers.length > 0
      ? new Set(state.providers)
      : new Set(IP_GRABBER_PROVIDER_IDS);

  const note =
    "-# Lists your keyword rules from Server Settings → AutoMod. Unticking a service removes its keywords; your own keywords are never touched.";

  return new ModalBuilder()
    .setCustomId(settingsIds.modal("ip-grabbers"))
    .setTitle("IP grabber links")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("AutoMod rule")
        .setDescription(
          "sushii adds the domains to this rule. Your keywords, actions and exemptions stay as they are.",
        )
        .setStringSelectMenuComponent(select),
      ...IP_GRABBER_PROVIDER_IDS.map((id) =>
        checkboxLabel({
          label: IP_GRABBER_PROVIDERS[id].name,
          customId: id,
          checked: enabled.has(id),
          description: IP_GRABBER_PROVIDERS[id].description,
        }),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(note));
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
    case "ip-grabbers":
      return buildIpGrabbersModal(ctx);
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
    case "ip-grabbers": {
      const [rule] = submission.fields.getStringSelectValues(FIELD.rule);
      return [
        {
          kind: "ipGrabbers",
          ruleId: !rule || rule === RULE_OFF ? null : rule,
          providers: IP_GRABBER_PROVIDER_IDS.filter((id) =>
            readCheckbox(submission, id),
          ),
        },
      ];
    }
  }
}
