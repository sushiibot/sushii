const NICKNAME_BUTTON_PREFIX = "alts:nickname:";

export function buildNicknameButtonId(identityId: number): string {
  return `${NICKNAME_BUTTON_PREFIX}${identityId}`;
}

export function parseNicknameButtonId(customId: string): number | null {
  if (!customId.startsWith(NICKNAME_BUTTON_PREFIX)) {
    return null;
  }

  const idStr = customId.slice(NICKNAME_BUTTON_PREFIX.length);
  const id = Number(idStr);
  return Number.isInteger(id) ? id : null;
}
