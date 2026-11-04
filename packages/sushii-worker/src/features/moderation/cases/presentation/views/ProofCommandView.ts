import type { InteractionEditReplyOptions } from "discord.js";
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionTypeBotEmojis } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  proofFileLinks,
  proofMediaUrls,
} from "@/features/moderation/shared/presentation/proof/proofBlock";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import { countWithNoun } from "@/shared/presentation/pluralize";
import Color from "@/utils/colors";
import { truncateText } from "@/utils/truncateText";

export const PROOF_COMMAND_EMOJIS = ActionTypeBotEmojis;
export type ProofCommandEmojis = EmojiMap<typeof PROOF_COMMAND_EMOJIS>;

export const PROOF_EMPTY_HINT = "Fill in `text`, attach a `file`, or both.";

const CHOICE_NAME_MAX_LENGTH = 100;
// Below this, a reason clipped to fit would be noise.
const CHOICE_REASON_MIN_LENGTH = 8;

/** `#4822 · Ban · spambot · 2 hours ago · <reason start…>`, at most 100 characters. */
export function formatProofCaseChoice(
  moderationCase: ModerationCase,
  now: Date,
): string {
  const head = truncateText(
    [
      `#${moderationCase.caseId}`,
      formatActionTypeAsSentence(moderationCase.actionType),
      moderationCase.userTag,
      dayjs(moderationCase.actionTime).from(now),
    ].join(" · "),
    CHOICE_NAME_MAX_LENGTH,
  );

  const reason = moderationCase.reason?.value.replace(/\s+/g, " ").trim();
  const room = CHOICE_NAME_MAX_LENGTH - head.length - " · ".length;
  if (!reason || room < CHOICE_REASON_MIN_LENGTH) {
    return head;
  }
  return `${head} · ${truncateText(reason, room)}`;
}

function savedLine(proof: CaseProof): string {
  const parts: string[] = [];
  if (proof.attachments.length > 0) {
    parts.push(countWithNoun(proof.attachments.length, "file"));
  }
  if (proof.content) {
    parts.push("your note");
  }

  let line = `-# Saved ${parts.join(" and ")}`;
  if (proof.hostMessageId) {
    line += " · mod log entry updated";
  }
  return line;
}

export interface ProofAddedInput {
  moderationCase: ModerationCase;
  proof: CaseProof;
  emojis: ProofCommandEmojis;
  modLogUrl: string | null;
}

/** The public /proof reply: what was added, to which case, and the files. */
export function buildProofAddedMessage(
  input: ProofAddedInput,
): InteractionEditReplyOptions & { flags: number } {
  const { moderationCase, proof } = input;
  const emoji = input.emojis[getActionTypeBotEmoji(moderationCase.actionType)];
  const action = formatActionTypeAsSentence(moderationCase.actionType);
  const header = [
    `✅ **Added proof to case #${moderationCase.caseId}** · ${emoji ? `${emoji} ` : ""}${action} · <@${moderationCase.userId}>`,
    savedLine(proof),
  ].join("\n");

  const container = new ContainerBuilder().setAccentColor(Color.Success);
  const headerText = new TextDisplayBuilder().setContent(header);
  if (input.modLogUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(headerText)
        .setButtonAccessory(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("Open mod log entry")
            .setURL(input.modLogUrl),
        ),
    );
  } else {
    container.addTextDisplayComponents(headerText);
  }

  if (proof.content) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(proof.content),
    );
  }

  const media = proofMediaUrls([proof]);
  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  const links = proofFileLinks([proof]);
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
