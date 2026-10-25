import type { ContainerBuilder } from "discord.js";

/** `gone` means the post or its channel was deleted. */
export type ScreeningPostEditResult = "edited" | "gone";

export interface ScreeningPostPublisher {
  post(channelId: string, container: ContainerBuilder): Promise<string>;
  edit(
    channelId: string,
    messageId: string,
    container: ContainerBuilder,
  ): Promise<ScreeningPostEditResult>;
}
