import { ButtonBuilder, ButtonStyle, escapeMarkdown } from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import { quoteMarkdownString } from "@/utils/markdown";

import type { CaseProof } from "../../domain/entities/CaseProof";
import { splitCaseAttachments } from "../caseMedia";
import { buildAddProofCustomId } from "./customIds";
import { withEmoji } from "./reasonBlock";

export const PROOF_EMOJIS = [
  "lock",
  "attachment",
] as const satisfies readonly BotEmojiNameType[];

export type ProofEmojis = EmojiMap<typeof PROOF_EMOJIS>;

type ProofEntry = Pick<
  CaseProof,
  | "authorId"
  | "createdAt"
  | "content"
  | "attachments"
  | "sourceMessageUrl"
  | "sourceAuthorId"
  | "sourceContent"
>;

export function proofHeading(emojis: ProofEmojis): string {
  return `**${withEmoji(emojis.lock, "Proof")}** · mods only`;
}

function fileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function proofEntryText(
  proof: ProofEntry,
  _emojis: ProofEmojis,
): string {
  const files = proof.attachments.filter(Boolean).length;
  const meta = [
    proof.authorId ? `<@${proof.authorId}>` : "Unknown mod",
    `<t:${Math.floor(proof.createdAt.getTime() / 1000)}:R>`,
    files > 0 ? fileCount(files) : null,
    proof.sourceAuthorId ? `message from <@${proof.sourceAuthorId}>` : null,
  ].filter((part) => part !== null);

  const lines = [`-# ${meta.join(" · ")}`];
  if (proof.content) {
    lines.push(proof.content);
  }
  if (proof.sourceContent) {
    lines.push(
      quoteMarkdownString(
        escapeMarkdown(proof.sourceContent, {
          maskedLink: true,
          heading: true,
          bulletedList: true,
          numberedList: true,
        }),
      ),
    );
  }
  if (proof.sourceMessageUrl) {
    lines.push(proof.sourceMessageUrl);
  }

  return lines.join("\n");
}

function splitProofAttachments(
  proofs: readonly Pick<CaseProof, "attachments">[],
) {
  return splitCaseAttachments(proofs.flatMap((proof) => proof.attachments));
}

/** URLs a Media Gallery can show, in proof order. */
export function proofMediaUrls(
  proofs: readonly Pick<CaseProof, "attachments">[],
): string[] {
  return splitProofAttachments(proofs).media;
}

/** Raw URLs for files a gallery can't show. */
export function proofFileLinks(
  proofs: readonly Pick<CaseProof, "attachments">[],
): string[] {
  return splitProofAttachments(proofs).links;
}

export function addProofButton(
  caseIds: string[],
  emojis: ProofEmojis,
  opts: { disabled?: boolean } = {},
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(buildAddProofCustomId(caseIds))
    .setStyle(ButtonStyle.Primary)
    .setLabel("Add proof")
    .setDisabled(opts.disabled ?? false);

  if (emojis.attachment) {
    button.setEmoji(emojis.attachment);
  }

  return button;
}
