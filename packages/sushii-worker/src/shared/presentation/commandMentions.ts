export interface CommandMentions {
  /** "rolemenu" | "rolemenu create" | "xp block channel". Returns </path:id> when the root command's ID is known, else `/path` in inline code. */
  mention(path: string, guildId?: string): string;
}

export function fallbackMention(path: string): string {
  return `\`/${path}\``;
}
