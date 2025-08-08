import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import type { Tag } from "../../domain/entities/Tag";
import { MODAL_FIELDS, MODAL_IDS } from "../TagConstants";

export function createEditContentModal(tag: Tag): ModalBuilder {
  const tagData = tag.toData();

  const textInput = new TextInputBuilder()
    .setCustomId(MODAL_FIELDS.CONTENT)
    .setLabel("Tag Content")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setValue(tagData.content || "")
    .setMaxLength(2000);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);

  return new ModalBuilder()
    .setCustomId(MODAL_IDS.EDIT_CONTENT)
    .setTitle(`Edit Content - ${tagData.name}`)
    .addComponents(row);
}

export function createRenameModal(tag: Tag): ModalBuilder {
  const tagData = tag.toData();

  const textInput = new TextInputBuilder()
    .setCustomId(MODAL_FIELDS.NEW_NAME)
    .setLabel("New Tag Name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(tagData.name)
    .setMinLength(1)
    .setMaxLength(32);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);

  return new ModalBuilder()
    .setCustomId(MODAL_IDS.RENAME)
    .setTitle(`Rename Tag - ${tagData.name}`)
    .addComponents(row);
}
