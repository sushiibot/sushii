export interface EmojiData {
  emojiString: string;
  emojiId?: string;
  emojiName?: string;
}

export function formatEmojiWithUrl(emoji: EmojiData): string {
  // For custom emojis, include the ID and image URL
  if (emoji.emojiId && emoji.emojiName) {
    const isAnimated = emoji.emojiString.startsWith("<a:");
    const extension = isAnimated ? "gif" : "png";
    const imageUrl = `https://cdn.discordapp.com/emojis/${emoji.emojiId}.${extension}`;
    return `${emoji.emojiString} – [${emoji.emojiName}](${imageUrl})`;
  }

  // For Unicode emojis, just return the emoji
  return emoji.emojiString;
}
