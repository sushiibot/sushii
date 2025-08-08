import type { APIPartialEmoji } from "discord.js";

const RE_EMOJI = /<(?<animated>a?)?:(?<name>\w+):(?<id>\d{17,20})>/;
const RE_EMOJI_UNICODE = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;

export interface ParsedEmoji {
  emoji: APIPartialEmoji;
  string: string;
}

function parseUnicodeEmoji(s: string): ParsedEmoji | null {
  const match = s.match(RE_EMOJI_UNICODE);

  if (!match) {
    return null;
  }

  return {
    emoji: {
      id: null,
      name: match[0],
    },
    string: match[0],
  };
}

export default function parseEmoji(s: string): ParsedEmoji | null {
  const match = s.match(RE_EMOJI);

  if (!match || !match.groups) {
    // Fallback to unicode emoji
    return parseUnicodeEmoji(s);
  }

  const { animated, name, id } = match.groups;

  return {
    emoji: {
      // Undefined if not animated
      animated: !!animated,
      id,
      name,
    },
    string: match[0],
  };
}
