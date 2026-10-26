import { ModalBuilder } from "discord.js";

import type { SettingsPatch } from "../../application/SettingsPatch";
import { settingsIds } from "../session/settingsIds";
import type { ModalContext, ModalSubmission } from "./ModalContext";
import {
  FIELD,
  channelSelectLabel,
  checkboxLabel,
  missingChannelHint,
  prefillChannel,
  readChannel,
  readCheckbox,
  readText,
  textLabel,
} from "./modalFields";

export type WelcomeTarget = "welcome-channel" | "join" | "leave";

const PLACEHOLDERS_DESCRIPTION =
  "Placeholders: <mention> <username> <server> <member_number>";

function buildChannelModal(ctx: ModalContext): ModalBuilder {
  const state = ctx.status.welcome["welcome-channel"];
  const channelId = prefillChannel(
    state,
    ctx.config.messageSettings.messageChannel,
  );

  return new ModalBuilder()
    .setCustomId(settingsIds.modal("welcome-channel"))
    .setTitle("Welcome channel")
    .addLabelComponents(
      channelSelectLabel({
        label: "Channel",
        description: `Where join and leave messages are sent. ${
          missingChannelHint(state, channelId) ??
          "Join and leave messages need a channel to send."
        }`,
        defaults: channelId ? [channelId] : [],
      }),
    );
}

function buildMessageModal(
  target: "join" | "leave",
  ctx: ModalContext,
): ModalBuilder {
  const settings = ctx.config.messageSettings;
  const isJoin = target === "join";

  return new ModalBuilder()
    .setCustomId(settingsIds.modal(target))
    .setTitle(isJoin ? "Join message" : "Leave message")
    .addLabelComponents(
      checkboxLabel({
        label: isJoin
          ? "Send a message when someone joins"
          : "Send a message when someone leaves",
        customId: FIELD.enabled,
        checked: ctx.status.welcome[target].kind !== "off",
      }),
      textLabel({
        label: "Message",
        description: PLACEHOLDERS_DESCRIPTION,
        current: isJoin ? settings.joinMessage : settings.leaveMessage,
      }),
    );
}

export function buildWelcomeModal(
  target: WelcomeTarget,
  ctx: ModalContext,
): ModalBuilder {
  if (target === "welcome-channel") {
    return buildChannelModal(ctx);
  }
  return buildMessageModal(target, ctx);
}

export function parseWelcomeModal(
  target: WelcomeTarget,
  submission: ModalSubmission,
): SettingsPatch[] {
  if (target === "welcome-channel") {
    return [{ kind: "welcomeChannel", channelId: readChannel(submission) }];
  }

  return [
    {
      kind: target === "join" ? "joinMessage" : "leaveMessage",
      enabled: readCheckbox(submission, FIELD.enabled),
      text: readText(submission),
    },
  ];
}
