const PREFIX = "prompt";

export function makeCustomId(promptId: string, action: string): string {
  return `${PREFIX}:${promptId}:${action}`;
}

export function parseCustomId(
  customId: string,
): { promptId: string; action: string } | null {
  const parts = customId.split(":");
  if (parts.length < 3 || parts[0] !== PREFIX) {
    return null;
  }
  return { promptId: parts[1], action: parts.slice(2).join(":") };
}
