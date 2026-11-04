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

/** Room for one reply's proof text, leaving space for its heading and file links. */
export const PROOF_REPLY_TEXT_MAX_LENGTH = 3400;

/**
 * Splits text into pieces of at most `max` characters, at line breaks where
 * possible. Nothing is dropped: a single longer line is cut mid-line.
 */
export function splitAtLineBreaks(text: string, max: number): string[] {
  const pieces: string[] = [];
  let current: string | null = null;

  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > max) {
      if (current !== null) {
        pieces.push(current);
        current = null;
      }
      pieces.push(rest.slice(0, max));
      rest = rest.slice(max);
    }

    const joined: string = current === null ? rest : `${current}\n${rest}`;
    if (joined.length > max && current !== null) {
      pieces.push(current);
      current = rest;
    } else {
      current = joined;
    }
  }
  pieces.push(current ?? "");

  return pieces;
}

export interface ProofReplyPart {
  /** 0-based; the first part names the case and the user. */
  index: number;
  total: number;
  text: string;
  /** Files go on the last part only. */
  proof: ModLogProof | null;
}

export interface ProofReplyInput {
  caseId: string;
  userId: string;
  emojis: ProofEmojis;
  part: ProofReplyPart;
}

/**
 * The proof text of one entry, split into reply-sized parts. The last part
 * holds the files; it carries no text when the text would crowd them out.
 */
export function proofReplyParts(
  proof: ModLogProof,
  emojis: ProofEmojis,
  pendingLinks: number,
  linkReserve: number,
): ProofReplyPart[] {
  const pieces = splitAtLineBreaks(
    proofEntryText(proof, emojis),
    PROOF_REPLY_TEXT_MAX_LENGTH,
  );
  const last = pieces.at(-1) ?? "";
  const hasFiles = proof.attachments.some(Boolean);
  if (
    hasFiles &&
    last.length + pendingLinks * linkReserve > PROOF_REPLY_TEXT_MAX_LENGTH
  ) {
    pieces.push("");
  }

  return pieces.map((text, index) => ({
    index,
    total: pieces.length,
    text,
    proof: index === pieces.length - 1 ? proof : null,
  }));
}

/** A reply to a full mod log entry that holds proof text and files. */
export function buildProofReplyMessage(input: ProofReplyInput): ModLogMessage {
  const { part, emojis } = input;
  const title = `**${withEmoji(emojis.lock, `More proof · Case #${input.caseId}`)}** · <@${input.userId}>`;
  const sub =
    part.total > 1
      ? `-# Reply to the entry above · mods only · part ${part.index + 1} of ${part.total}`
      : "-# Reply to the entry above · mods only";
  const container = new ContainerBuilder()
    .setAccentColor(Color.DiscordGrey)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${title}\n${sub}`),
    );

  if (part.text) {
    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(part.text));
  }

  const proofs = part.proof ? [part.proof] : [];
  const media = proofMediaUrls(proofs);
  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  const links = proofFileLinks(proofs).filter(
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
