import {
  ActionRowBuilder,
  ButtonBuilder,
  ContextMenuCommandBuilder,
} from "@discordjs/builders";
import { isGuildInteraction } from "discord-api-types/utils/v10";
import {
  APIContextMenuInteraction,
  ApplicationCommandType,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import Context from "../../../model/context";
import memberIsTimedOut from "../../../utils/member";
import { hasPermission } from "../../../utils/permissions";
import customIds from "../../customIds";
import ContextMenuHandler from "../../handlers/ContextMenuHandler";
import getUserinfoEmbed from "../../user/userinfo.service";
import { ActionType } from "../ActionType";

export default class UserInfoHandler extends ContextMenuHandler {
  serverOnly = true;

  command = new ContextMenuCommandBuilder()
    .setName("User Info")
    .setType(ApplicationCommandType.User)
    .toJSON();

  // eslint-disable-next-line class-methods-use-this
  async handler(
    ctx: Context,
    interaction: APIContextMenuInteraction
  ): Promise<void> {
    if (!isGuildInteraction(interaction)) {
      throw new Error("Not a guild interaction");
    }

    if ("messages" in interaction.data.resolved) {
      throw new Error(
        "Message should not be resolved: not a user application command"
      );
    }

    const targetID = interaction.data.target_id;
    const targetUser = interaction.data.resolved.users[targetID];
    const targetMember = interaction.data.resolved.members?.[targetID];

    const isModerator = hasPermission(
      interaction.member.permissions,
      PermissionFlagsBits.BanMembers
    );

    const embed = await getUserinfoEmbed(
      ctx,
      interaction,
      targetUser,
      targetMember
    );

    if (!isModerator) {
      await ctx.REST.interactionReply(interaction, {
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const isMuted = memberIsTimedOut(targetMember);

    const banButton = new ButtonBuilder()
      .setCustomId(
        customIds.lookupButton.compile({
          actionType: ActionType.Ban,
          targetId: targetID,
        })
      )
      .setLabel("Ban")
      .setEmoji({
        name: "🔨",
      })
      .setStyle(ButtonStyle.Danger);

    const kickButton = new ButtonBuilder()
      .setCustomId(
        customIds.lookupButton.compile({
          actionType: ActionType.Kick,
          targetId: targetID,
        })
      )
      .setLabel("Kick")
      .setEmoji({
        name: "👢",
      })
      .setStyle(ButtonStyle.Secondary);

    // Mute or unmute depending on timeout state
    const muteButton = isMuted
      ? new ButtonBuilder()
          .setCustomId(
            customIds.lookupButton.compile({
              actionType: ActionType.TimeoutRemove,
              targetId: targetID,
            })
          )
          .setLabel("Unmute")
          .setEmoji({
            name: "🔉",
          })
          .setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder()
          .setCustomId(
            customIds.lookupButton.compile({
              actionType: ActionType.Timeout,
              targetId: targetID,
            })
          )
          .setLabel("Mute")
          .setEmoji({
            name: "🔇",
          })
          .setStyle(ButtonStyle.Secondary);

    const warnButton = new ButtonBuilder()
      .setCustomId(
        customIds.lookupButton.compile({
          actionType: ActionType.Warn,
          targetId: targetID,
        })
      )
      .setLabel("Warn")
      .setEmoji({
        name: "⚠",
      })
      .setStyle(ButtonStyle.Secondary);

    const topRow = new ActionRowBuilder<ButtonBuilder>().addComponents([
      banButton,
      kickButton,
      muteButton,
      warnButton,
    ]);

    const historyButton = new ButtonBuilder()
      .setCustomId(
        customIds.lookupButton.compile({
          actionType: ActionType.History,
          targetId: targetID,
        })
      )
      .setLabel("History")
      .setStyle(ButtonStyle.Secondary);

    const lookupButton = new ButtonBuilder()
      .setCustomId(
        customIds.lookupButton.compile({
          actionType: ActionType.Lookup,
          targetId: targetID,
        })
      )
      .setLabel("Lookup")
      .setStyle(ButtonStyle.Secondary);

    const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents([
      historyButton,
      lookupButton,
    ]);

    await ctx.REST.interactionReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      components: [topRow.toJSON(), secondRow.toJSON()],
    });
  }
}
