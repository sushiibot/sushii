import type { APIUser } from "discord.js";

export function getAPIUserTag(user: APIUser): string {
  return user.discriminator === "0"
    ? user.username
    : `${user.username}#${user.discriminator}`;
}
