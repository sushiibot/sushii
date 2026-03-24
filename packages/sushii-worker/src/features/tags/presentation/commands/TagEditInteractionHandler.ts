import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";

import type { TagService } from "../../application/TagService";
import type { Tag } from "../../domain/entities/Tag";
import {
  CUSTOM_IDS,
  DELETE_CONFIRMATION_TIMEOUT,
  EDIT_INTERFACE_TIMEOUT,
  MODAL_FIELDS,
  MODAL_SUBMISSION_TIMEOUT,
} from "../TagConstants";
import {
  TAG_STATUS_EMOJIS,
  type TagStatusEmojiMap,
  createTagDeleteConfirmationMessage,
  createTagEditMessage,
  createTagErrorContainer,
} from "../views/TagMessageBuilder";
import {
  createEditContentModal,
  createRenameModal,
} from "../views/TagModalBuilder";

export class TagEditInteractionHandler {
  constructor(
    private readonly tagService: TagService,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly logger: Logger,
  ) {}

  async handleEditInterface(
    interaction: ChatInputCommandInteraction<"cached">,
    tag: Tag,
  ): Promise<void> {
    const emojis = await this.emojiRepository.getEmojis(TAG_STATUS_EMOJIS);

    const message = createTagEditMessage(tag);
    const interactionResponse = await interaction.reply(message);

    const collector = interactionResponse.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: EDIT_INTERFACE_TIMEOUT,
    });

    let updatedTag: Tag | undefined;

    collector.on("collect", async (buttonInteraction) => {
      try {
        if (buttonInteraction.user.id !== interaction.user.id) {
          await buttonInteraction.reply({
            components: [
              createTagErrorContainer(
                "Sorry",
                "Only the person who ran this command can use these buttons.",
                emojis["fail"],
              ),
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });

          return;
        }

        // Always update the tag to latest state before handlers
        const currentTag = updatedTag || tag;

        if (buttonInteraction.customId === CUSTOM_IDS.EDIT_CONTENT) {
          updatedTag = await this.handleEditContentModal(
            buttonInteraction,
            currentTag,
            emojis,
          );
        } else if (buttonInteraction.customId === CUSTOM_IDS.RENAME) {
          updatedTag = await this.handleRenameModal(
            buttonInteraction,
            currentTag,
            emojis,
          );
        } else if (buttonInteraction.customId === CUSTOM_IDS.DELETE) {
          const wasDeleted = await this.handleDeleteConfirmation(
            interaction,
            buttonInteraction,
            currentTag,
            emojis,
          );
          if (wasDeleted) {
            collector.stop();
            return;
          }
        }
      } catch (err) {
        this.logger.error(
          {
            interactionId: interaction.id,
            err,
          },
          "Error handling tag edit interaction",
        );

        await buttonInteraction.reply({
          components: [
            createTagErrorContainer(
              "Error",
              "An error occurred while processing your request.",
              emojis["fail"],
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      }
    });

    await new Promise<void>((resolve) => {
      collector.on("end", async (_collected, endReason) => {
        try {
          if (endReason === "time") {
            const currentTag = updatedTag || tag;

            // Need to re-fetch tag, `tag` is initial state
            const refreshedTag = await this.tagService.getTag(
              // If renamed, use the new name, otherwise use the original tag name
              currentTag.getName().getValue(),
              interaction.guildId,
            );

            if (!refreshedTag) {
              this.logger.warn(
                `Tag not found after edit interface timeout: ${tag.getName().getValue()}`,
              );

              return;
            }

            const message = createTagEditMessage(refreshedTag, {
              disabled: true,
            });
            await interaction.editReply(message);
          }
        } catch (err) {
          this.logger.error(
            {
              interactionId: interaction.id,
              err,
            },
            "Error finalizing tag edit interaction",
          );
        } finally {
          resolve();
        }
      });
    });
  }

  private async handleEditContentModal(
    interaction: ButtonInteraction<"cached">,
    tag: Tag,
    emojis: TagStatusEmojiMap,
  ): Promise<Tag | undefined> {
    const tagData = tag.toData();
    const modal = createEditContentModal(tag);

    await interaction.showModal(modal);

    try {
      const modalSubmission = await interaction.awaitModalSubmit({
        time: MODAL_SUBMISSION_TIMEOUT,
      });
      if (!modalSubmission.isFromMessage()) {
        throw new Error("Modal submission is not from a message");
      }

      const newContent = modalSubmission.fields.getTextInputValue(
        MODAL_FIELDS.CONTENT,
      );

      const updatedTagResult = await this.tagService.updateTag({
        name: tagData.name,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        hasManageGuildPermission: interaction.member.permissions.has(
          PermissionFlagsBits.ManageGuild,
        ),
        newContent: newContent.length > 0 ? newContent : null,
        newAttachment: tagData.attachment ?? undefined,
      });
      if (updatedTagResult.err) {
        await modalSubmission.reply({
          components: [
            createTagErrorContainer(
              "Update Failed",
              updatedTagResult.val,
              emojis["fail"],
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });

        return;
      }

      const editMsg = createTagEditMessage(updatedTagResult.val);
      await modalSubmission.update(editMsg);

      return updatedTagResult.val;
    } catch (err) {
      this.logger.debug(
        {
          interactionId: interaction.id,
          err,
        },
        "Modal submission timed out or failed",
      );
    }
  }

  private async handleRenameModal(
    interaction: ButtonInteraction<"cached">,
    tag: Tag,
    emojis: TagStatusEmojiMap,
  ): Promise<Tag | undefined> {
    const tagData = tag.toData();
    const modal = createRenameModal(tag);

    await interaction.showModal(modal);

    try {
      const modalSubmission = await interaction.awaitModalSubmit({
        time: MODAL_SUBMISSION_TIMEOUT,
      });
      if (!modalSubmission.isFromMessage()) {
        throw new Error("Modal submission is not from a message");
      }

      const newName = modalSubmission.fields.getTextInputValue(
        MODAL_FIELDS.NEW_NAME,
      );

      const renamedTagResult = await this.tagService.renameTag({
        currentName: tagData.name,
        newName: newName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        hasManageGuildPermission: interaction.member.permissions.has(
          PermissionFlagsBits.ManageGuild,
        ),
      });

      if (renamedTagResult.err) {
        await modalSubmission.reply({
          components: [
            createTagErrorContainer(
              "Rename Failed",
              renamedTagResult.val,
              emojis["fail"],
            ),
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });

        return;
      }

      const editMsg = createTagEditMessage(renamedTagResult.val);
      await modalSubmission.update(editMsg);

      return renamedTagResult.val;
    } catch (err) {
      this.logger.debug(
        {
          interactionId: interaction.id,
          err,
        },
        "Modal submission timed out or failed",
      );
    }
  }

  private async handleDeleteConfirmation(
    originalInteraction: ChatInputCommandInteraction<"cached">,
    buttonInteraction: ButtonInteraction<"cached">,
    tag: Tag,
    emojis: TagStatusEmojiMap,
  ): Promise<boolean> {
    const tagData = tag.toData();

    const message = createTagDeleteConfirmationMessage(
      tag.getName().getValue(),
    );

    // Interaction is the button interaction, so we need to **reply** not to
    // send followUp
    const confirmationMsg = await buttonInteraction.reply({
      ...message,
      withResponse: true,
    });

    if (!confirmationMsg.resource?.message) {
      throw new Error(
        "Failed to send delete confirmation message, no message resource found",
      );
    }

    this.logger.debug(
      {
        interactionId: buttonInteraction.id,
        confirmationMessageId: confirmationMsg.resource.message.id,
      },
      "Sent delete confirmation message",
    );

    const collector =
      confirmationMsg.resource.message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: DELETE_CONFIRMATION_TIMEOUT,
      });

    return new Promise<boolean>((resolve) => {
      let deleted = false;

      collector.on("collect", async (confirmInteraction) => {
        try {
          if (confirmInteraction.user.id !== buttonInteraction.user.id) {
            await confirmInteraction.reply({
              components: [
                createTagErrorContainer(
                  "Not your confirmation",
                  "Only the person who initiated the delete can confirm it.",
                  emojis["fail"],
                ),
              ],
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
            return;
          }

          this.logger.debug(
            {
              interactionId: buttonInteraction.id,
              buttonInteractionId: confirmInteraction.id,
              customId: confirmInteraction.customId,
            },
            "Handling delete confirmation button interactions",
          );

          if (confirmInteraction.customId === CUSTOM_IDS.CONFIRM_DELETE) {
            const result = await this.tagService.deleteTag({
              name: tagData.name,
              guildId: buttonInteraction.guildId,
              userId: buttonInteraction.user.id,
              hasManageGuildPermission:
                buttonInteraction.member.permissions.has(
                  PermissionFlagsBits.ManageGuild,
                ),
            });

            if (result.err) {
              await confirmInteraction.update({
                components: [
                  createTagErrorContainer(
                    "Delete Failed",
                    result.val,
                    emojis["fail"],
                  ),
                ],
              });

              collector.stop();
              return;
            }

            // Update original message with deleted state
            const deletedTag = result.val;
            const message = createTagEditMessage(deletedTag, {
              deleted: true,
            });
            await originalInteraction.editReply({
              ...message,
            });

            // Delete confirmation message
            await buttonInteraction.deleteReply();

            deleted = true;
            collector.stop();
          } else if (confirmInteraction.customId === CUSTOM_IDS.CANCEL_DELETE) {
            // Just delete the reply message
            await buttonInteraction.deleteReply();
            collector.stop();
          }
        } catch (err) {
          this.logger.error(
            {
              interactionId: buttonInteraction.id,
              err,
            },
            "Error occurred while handling delete confirmation",
          );
          collector.stop();
        }
      });

      collector.on("end", async (_collected, endReason) => {
        if (endReason === "time") {
          try {
            await buttonInteraction.deleteReply();
          } catch {
            // Interaction token may have expired
          }
        }

        resolve(deleted);
      });
    });
  }
}
