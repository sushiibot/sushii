export function extractKeywords(messageContent: string): string[] {
  return messageContent
    .toLowerCase()
    .split(/\b(\w+)\b/g)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function containsKeyword(
  messageContent: string,
  keyword: string,
): boolean {
  const keywords = extractKeywords(messageContent);
  const cleanedKeyword = keyword.toLowerCase().trim();
  return keywords.includes(cleanedKeyword);
}
