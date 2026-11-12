import type {
  APIComponentInContainer,
  APIMessageTopLevelComponent,
} from "discord.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import { ACTION_RESPONSE_IDS } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import Color from "@/utils/colors";

import type { ProofSuggestion } from "../domain/ProofSuggestion";
import type { SuggestionAddResult } from "./SuggestionFlow";
import {
  buildAddAllId,
  buildAddSelectedId,
  buildReviewId,
  buildSelectId,
  buildUndoId,
} from "./customIds";
import {
  ADD_FAILED_TEXT,
  CASE_GONE_TEXT,
  KIND_EMOJI,
  actionNoun,
  addedText,
  nothingAddedText,
  pickerSectionText,
  previewDescription,
  responseBlockText,
  selectLabel,
} from "./suggestionText";

function separator(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

export interface ResponseBlockInput {
  caseId: string;
  fingerprint: string;
  suggestions: readonly ProofSuggestion[];
  targetName: string;
  actionType: ActionType;
}

/** Text-only block for the public action response: no message content, names of others or previews. */
export function buildResponseSuggestionBlock(
  input: ResponseBlockInput,
): APIComponentInContainer[] {
  const count = input.suggestions.length;
  return [
    separator().toJSON(),
    new TextDisplayBuilder()
      .setId(ACTION_RESPONSE_IDS.suggestions)
      .setContent(responseBlockText(input))
      .toJSON(),
    new ActionRowBuilder<ButtonBuilder>()
      .setId(ACTION_RESPONSE_IDS.suggestionsRow)
      .addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Success)
          .setLabel(`Add all ${count}`)
          .setEmoji("✅")
          .setCustomId(buildAddAllId(input.caseId, input.fingerprint)),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Review…")
          .setEmoji("🔍")
          .setCustomId(buildReviewId(input.caseId, input.fingerprint)),
      )
      .toJSON(),
  ];
}

export interface PickerItem {
  suggestion: ProofSuggestion;
  channelName: string | null;
  /** null when the preview couldn't be rendered; the suggestion shows as text only. */
  image: { name: string; png: Buffer } | null;
}

export interface PickerInput {
  caseId: string;
  fingerprint: string;
  targetId: string;
  targetName: string;
  actionType: ActionType;
  items: readonly PickerItem[];
  /** Custom id of the regular Add proof button for this case. */
  addOtherProofId: string;
}

export interface PickerMessage {
  components: ContainerBuilder[];
  files: AttachmentBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
}

function pickerHeading(caseId: string): string {
  return `### 💡 Suggested proof · Case #${caseId}`;
}

function addOtherProofButton(customId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Add other proof…")
    .setEmoji("📎")
    .setCustomId(customId);
}

function addSelectedButton(
  caseId: string,
  fingerprint: string,
  count: number,
): ButtonBuilder {
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Success)
    .setLabel(`Add ${count}`)
    .setEmoji("✅")
    .setDisabled(count === 0)
    .setCustomId(buildAddSelectedId(caseId, fingerprint));
}

/** Ephemeral only: the previews show message content and other members. */
export function buildPicker(
  input: PickerInput,
  selected: ReadonlySet<number>,
): PickerMessage {
  const { items } = input;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${pickerHeading(input.caseId)}\nFrom <@${input.targetId}>'s last activity before the ${actionNoun(input.actionType)}, in channels you can read. Proof saves links, not these previews.`,
      ),
    )
    .addSeparatorComponents(separator());

  const files: AttachmentBuilder[] = [];
  items.forEach((item) => {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(pickerSectionText(item.suggestion)),
    );
    if (item.image) {
      files.push(
        new AttachmentBuilder(item.image.png, { name: item.image.name }),
      );
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(`attachment://${item.image.name}`)
            .setDescription(
              previewDescription(
                item.suggestion,
                input.targetName,
                item.channelName,
              ),
            ),
        ),
      );
    }
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildSelectId(input.caseId, input.fingerprint))
    .setPlaceholder("Pick suggestions")
    .setMinValues(0)
    .setMaxValues(items.length)
    .addOptions(
      items.map((item, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(selectLabel(item.suggestion, item.channelName))
          .setValue(String(index))
          .setEmoji(KIND_EMOJI[item.suggestion.kind])
          .setDefault(selected.has(index)),
      ),
    );

  container
    .addSeparatorComponents(separator())
    .addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        addSelectedButton(input.caseId, input.fingerprint, selected.size),
        addOtherProofButton(input.addOtherProofId),
      ),
    );

  return {
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildNothingLeft(
  caseId: string,
  addOtherProofId: string,
): PickerMessage {
  return {
    components: [
      new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${pickerHeading(caseId)}\nNothing to suggest anymore. The messages may be older than 7 days, or in channels you can't read.`,
          ),
        )
        .addActionRowComponents(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            addOtherProofButton(addOtherProofId),
          ),
        ),
    ],
    files: [],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

type Raw = Record<string, unknown> & { type: number };

/** A posted component sent again, without Discord's extra media fields. */
function cleanCopy(source: Raw): Raw {
  switch (source.type) {
    case ComponentType.MediaGallery:
      return {
        ...source,
        items: (source.items as Raw[]).map((item) => ({
          media: { url: (item.media as { url: string }).url },
          ...(item.description ? { description: item.description } : {}),
          ...(item.spoiler ? { spoiler: item.spoiler } : {}),
        })),
      };
    case ComponentType.ActionRow:
      return {
        ...source,
        components: (source.components as Raw[]).map((c) => ({ ...c })),
      };
    default:
      return { ...source };
  }
}

/**
 * The posted picker with the select's defaults and the Add button's count
 * set to `selected`. Files stay attached since the edit sends no attachments.
 */
export function pickerWithSelection(
  posted: readonly APIMessageTopLevelComponent[],
  selected: readonly string[],
): { components: Raw[]; flags: MessageFlags.IsComponentsV2 } | null {
  const container = posted.find((c) => c.type === ComponentType.Container) as
    | (Raw & { components: Raw[] })
    | undefined;
  if (!container) {
    return null;
  }

  const wanted = new Set(selected);
  let foundSelect = false;
  const components = container.components.map((child) => {
    const copy = cleanCopy(child);
    if (copy.type !== ComponentType.ActionRow) {
      return copy;
    }
    copy.components = (copy.components as Raw[]).map((c) => {
      if (c.type === ComponentType.StringSelect) {
        foundSelect = true;
        return {
          ...c,
          options: (c.options as Raw[]).map((o) => ({
            ...o,
            default: wanted.has(o.value as string),
          })),
        };
      }
      if (
        c.type === ComponentType.Button &&
        typeof c.custom_id === "string" &&
        c.custom_id.startsWith("proof/suggest/add-selected/")
      ) {
        return {
          ...c,
          label: `Add ${wanted.size}`,
          disabled: wanted.size === 0,
        };
      }
      return c;
    });
    return copy;
  });

  if (!foundSelect) {
    return null;
  }

  return {
    components: [{ ...container, components }],
    flags: MessageFlags.IsComponentsV2,
  };
}

/** Values the picker's select currently has checked, read from the posted message. */
export function selectedInPicker(
  posted: readonly APIMessageTopLevelComponent[],
): string[] | null {
  for (const top of posted) {
    if (top.type !== ComponentType.Container) {
      continue;
    }
    for (const child of top.components) {
      if (child.type !== ComponentType.ActionRow) {
        continue;
      }
      for (const c of child.components) {
        if (c.type === ComponentType.StringSelect) {
          return c.options.filter((o) => o.default).map((o) => o.value);
        }
      }
    }
  }
  return null;
}

export interface NoticeMessage {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
}

function notice(
  text: string,
  accent: number,
  undo?: { caseId: string; batchId: string },
): NoticeMessage {
  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  if (undo) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Undo")
          .setEmoji("↩️")
          .setCustomId(buildUndoId(undo.caseId, undo.batchId)),
      ),
    );
  }
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildAddedMessage(
  text: string,
  undo: { caseId: string; batchId: string },
): NoticeMessage {
  return notice(text, Color.Success, undo);
}

/** `retry` keeps the Undo button for another try. */
export function buildUndoResult(
  text: string,
  accent: number,
  retry?: { caseId: string; batchId: string },
): NoticeMessage {
  return notice(text, accent, retry);
}

export function buildSuggestionAddResult(
  result: SuggestionAddResult,
): NoticeMessage {
  switch (result.kind) {
    case "already_added":
      return buildSuggestionNotice("Already added.");
    case "added":
      return buildAddedMessage(addedText(result.summary), {
        caseId: result.summary.caseId,
        batchId: result.batchId,
      });
    case "nothing_linked":
      return buildSuggestionNotice(nothingAddedText(result.summary));
    case "case_not_found":
      return buildSuggestionNotice(CASE_GONE_TEXT, Color.Error);
    case "failed":
      return buildSuggestionNotice(ADD_FAILED_TEXT, Color.Error);
  }
}

export function buildSuggestionNotice(
  text: string,
  accent: number = Color.Warning,
): NoticeMessage {
  return notice(text, accent);
}
