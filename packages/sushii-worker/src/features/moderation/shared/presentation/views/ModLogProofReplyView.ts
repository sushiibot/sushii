import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import {
  type ProofEmojis,
  proofEntryText,
  proofFileLinks,
  proofMediaUrls,
} from "../proof/proofBlock";
import { withEmoji } from "../proof/reasonBlock";
import type { ModLogMessage, ModLogProof } from "./ModLogMessageView";

export interface ProofReplyInput {
  caseId: string;
  userId: string;
  proof: ModLogProof;
  emojis: ProofEmojis;
}

/** A reply to a full mod log entry that holds one more proof entry and its files. */
export function buildProofReplyMessage(input: ProofReplyInput): ModLogMessage {
  const { proof, emojis } = input;
  const container = new ContainerBuilder()
    .setAccentColor(Color.DiscordGrey)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${withEmoji(emojis.lock, `More proof · Case #${input.caseId}`)}** · <@${input.userId}>\n-# Reply to the entry above · mods only`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(proofEntryText(proof, emojis)),
    );

  const media = proofMediaUrls([proof]);
  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  const links = proofFileLinks([proof]).filter(
    (url) => !url.startsWith("attachment://"),
  );
  if (links.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(links.join("\n")),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
