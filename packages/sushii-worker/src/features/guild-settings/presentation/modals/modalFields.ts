import type { Guild } from "discord.js";
import {
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxBuilder,
  ComponentType,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import type { RowState } from "../../application/SettingsStatus";
import { compareSnowflakes } from "../utils/compareSnowflakes";
import type { ModalContext, ModalSubmission } from "./ModalContext";

export const FIELD = {
  channel: "channel",
  ignored: "ignored",
  enabled: "enabled",
  sources: "sources",
  text: "text",
  roles: "roles",
  avatars: "avatars",
} as const;

const TEXT_MAX_LENGTH = 1000;
const TEXT_INPUT_LIMIT = 4000;
export const MAX_IGNORED_CHANNELS = 25;

const LOG_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
];

/**
 * Discord can reject a whole modal over a deleted or wrong-type default, so
 * only IDs the guild cache resolves are pre-filled.
 */
export function resolveModalPrefills(
  guild: Pick<Guild, "channels" | "roles">,
  ignoredChannelIds: string[],
  exemptRoleIds: string[],
): Pick<ModalContext, "prefilledIgnoredChannelIds" | "prefilledExemptRoleIds"> {
  const isLogChannel = (id: string): boolean => {
    const type = guild.channels.cache.get(id)?.type;
    return type !== undefined && LOG_CHANNEL_TYPES.includes(type);
  };

  return {
    prefilledIgnoredChannelIds: ignoredChannelIds
      .filter(isLogChannel)
      .sort(compareSnowflakes)
      .slice(0, MAX_IGNORED_CHANNELS),
    prefilledExemptRoleIds: exemptRoleIds.filter((id) =>
      guild.roles.cache.has(id),
    ),
  };
}

/**
 * Pre-filling an off row would turn it on when submitted untouched, and a
 * deleted or wrong-type channel ID can make Discord reject the whole modal.
 */
export function prefillChannel(
  state: RowState | null,
  channelId: string | null,
): string | null {
  const channelExists =
    state?.kind === "on" ||
    (state?.kind === "attention" &&
      state.problem.kind === "missing_permissions");
  return channelExists ? channelId : null;
}

const MISSING_CHANNEL_HINT = "Its channel is gone, pick a new one.";

/** Set when the row needs attention but its channel couldn't be pre-filled. */
export function missingChannelHint(
  state: RowState | null,
  prefilled: string | null,
): string | null {
  return state?.kind === "attention" && !prefilled
    ? MISSING_CHANNEL_HINT
    : null;
}

export function channelHint(
  state: RowState | null,
  prefilled: string | null,
): string {
  if (prefilled) {
    return "Clear it to turn off.";
  }
  return missingChannelHint(state, prefilled) ?? "Pick one to turn on.";
}

export function channelSelectLabel(opts: {
  label: string;
  description: string;
  customId?: string;
  defaults: string[];
  maxValues?: number;
}): LabelBuilder {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(opts.customId ?? FIELD.channel)
    .addChannelTypes(LOG_CHANNEL_TYPES)
    .setMinValues(0)
    .setMaxValues(opts.maxValues ?? 1)
    .setRequired(false);

  if (opts.defaults.length > 0) {
    select.setDefaultChannels(opts.defaults);
  }

  return new LabelBuilder()
    .setLabel(opts.label)
    .setDescription(opts.description)
    .setChannelSelectMenuComponent(select);
}

export function checkboxLabel(opts: {
  label: string;
  customId: string;
  checked: boolean;
  description?: string;
}): LabelBuilder {
  const label = new LabelBuilder()
    .setLabel(opts.label)
    .setCheckboxComponent(
      new CheckboxBuilder().setCustomId(opts.customId).setDefault(opts.checked),
    );
  if (opts.description) {
    label.setDescription(opts.description);
  }
  return label;
}

export function textLabel(opts: {
  label: string;
  description: string;
  current: string | null;
}): LabelBuilder {
  const current = opts.current ?? "";
  const shortened = current.length > TEXT_INPUT_LIMIT;
  const input = new TextInputBuilder()
    .setCustomId(FIELD.text)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(
      Math.min(TEXT_INPUT_LIMIT, Math.max(TEXT_MAX_LENGTH, current.length)),
    )
    .setRequired(false);

  if (current) {
    input.setValue(current.slice(0, TEXT_INPUT_LIMIT));
  }

  return new LabelBuilder()
    .setLabel(opts.label)
    .setDescription(
      shortened
        ? `${opts.description} Shortened to ${TEXT_INPUT_LIMIT} characters.`
        : opts.description,
    )
    .setTextInputComponent(input);
}

export function readText(submission: ModalSubmission): string | null {
  const text = submission.fields.getTextInputValue(FIELD.text).trim();
  return text === "" ? null : text;
}

export function readSelectValues(
  submission: ModalSubmission,
  customId: string,
  type: ComponentType.ChannelSelect | ComponentType.RoleSelect,
): string[] {
  // The typed getField overload resolves select fields to never, so check the type here.
  const field = submission.fields.getField(customId);
  if (field.type !== type) {
    throw new Error("Unexpected modal field type", {
      cause: { customId, expected: type, actual: field.type },
    });
  }
  // Treat an omitted values array as a cleared select.
  return [...(field.values ?? [])];
}

export function readChannels(
  submission: ModalSubmission,
  customId: string,
): string[] {
  return readSelectValues(submission, customId, ComponentType.ChannelSelect);
}

export function readChannel(submission: ModalSubmission): string | null {
  return readChannels(submission, FIELD.channel)[0] ?? null;
}

export function readCheckbox(
  submission: ModalSubmission,
  customId: string,
): boolean {
  return submission.fields.getCheckbox(customId);
}
