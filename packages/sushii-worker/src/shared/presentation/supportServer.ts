import { ButtonBuilder, ButtonStyle } from "discord.js";

export const SUPPORT_SERVER_URL = "https://discord.gg/PjDRRXSSAF";

export function buildSupportServerButton(
  label = "Support server",
): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel(label)
    .setURL(SUPPORT_SERVER_URL)
    .setStyle(ButtonStyle.Link);
}
