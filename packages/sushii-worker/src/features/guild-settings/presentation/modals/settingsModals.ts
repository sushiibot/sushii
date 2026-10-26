import type { ModalBuilder } from "discord.js";

import type { SettingsPatch } from "../../application/SettingsPatch";
import type { SettingsEditTarget } from "../session/settingsIds";
import type { ModalContext, ModalSubmission } from "./ModalContext";
import { buildAutomodModal, parseAutomodModal } from "./automodModals";
import { buildDmModal, parseDmModal } from "./dmModals";
import { buildLogModal, parseLogModal } from "./logModals";
import { buildWelcomeModal, parseWelcomeModal } from "./welcomeModals";

export type { ModalContext } from "./ModalContext";

export function buildSettingsModal(
  target: SettingsEditTarget,
  ctx: ModalContext,
): ModalBuilder {
  switch (target) {
    case "modlog":
    case "memberlog":
    case "msglog":
    case "reactionlog":
      return buildLogModal(target, ctx);
    case "dm-timeout":
    case "dm-warn":
    case "dm-ban":
    case "dm-kick":
      return buildDmModal(target, ctx);
    case "welcome-channel":
    case "join":
    case "leave":
      return buildWelcomeModal(target, ctx);
    case "exempt":
    case "alerts":
    case "screening":
      return buildAutomodModal(target, ctx);
  }
}

export function parseSettingsModal(
  target: SettingsEditTarget,
  submission: ModalSubmission,
  ctx: ModalContext,
): SettingsPatch[] {
  switch (target) {
    case "modlog":
    case "memberlog":
    case "msglog":
    case "reactionlog":
      return parseLogModal(target, submission, ctx);
    case "dm-timeout":
    case "dm-warn":
    case "dm-ban":
    case "dm-kick":
      return parseDmModal(target, submission);
    case "welcome-channel":
    case "join":
    case "leave":
      return parseWelcomeModal(target, submission);
    case "exempt":
    case "alerts":
    case "screening":
      return parseAutomodModal(target, submission);
  }
}
