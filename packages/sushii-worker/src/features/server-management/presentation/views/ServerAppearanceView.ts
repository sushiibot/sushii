import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
  time,
} from "discord.js";

import Color from "@/utils/colors";

import type {
  ServerImageChange,
  ServerNameRestore,
  ServerRename,
} from "../../application/ServerAppearanceService";
import type {
  ServerImageError,
  ServerImageKind,
} from "../../domain/serverImage";

export type ServerAppearanceError =
  | ServerImageError
  | "invalid_image"
  | "nothing_saved"
  | "bot_missing_permission";

export function describeServerAppearanceError(
  error: ServerAppearanceError,
  kind: ServerImageKind | "name",
  mention: (path: string) => string,
): string {
  switch (error) {
    case "not_image":
      return "That file isn't an image. Upload a PNG, JPG, GIF or WebP.";
    case "too_large":
      return "That image is over 10 MB. Upload a smaller file.";
    case "banner_locked":
      return "This server can't have a banner yet. Server banners unlock at boost level 2.";
    case "animated_locked":
      return kind === "banner"
        ? "Animated banners need boost level 3. Upload a PNG or JPG instead."
        : "Animated icons need boost level 1. Upload a PNG or JPG instead.";
    case "invalid_image":
      return "Discord couldn't use that image. Try a different file.";
    case "nothing_saved":
      return `There's no saved server name to restore. One is saved the first time the server is renamed with ${mention("server name")}.`;
    case "bot_missing_permission":
      return `sushii needs the **Manage Server** permission to change the server ${kind}.`;
  }
}

export function buildServerAppearanceErrorReply(
  text: string,
): InteractionReplyOptions {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Error)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text)),
    ],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function heading(title: string, executorId: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    `## ${title}\n-# Changed by <@${executorId}>`,
  );
}

function hint(text: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(`-# ${text}`);
}

export function buildServerImageChangedMessage(
  kind: ServerImageKind,
  change: ServerImageChange,
  executorId: string,
  mention: (path: string) => string,
): InteractionEditReplyOptions {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(heading(`Server ${kind} updated`, executorId));

  const previousFile = change.previous?.file ?? null;
  const previousUrl = previousFile
    ? `attachment://${previousFile.filename}`
    : (change.previous?.url ?? null);

  if (kind === "icon") {
    addIconRow(container, "Before", previousUrl, "no icon");
    addIconRow(container, "After", change.currentUrl, "no icon");
  } else {
    addBannerRow(container, "Before", previousUrl, "no banner");
    addBannerRow(container, "After", change.currentUrl, "no banner");
  }

  if (change.previous) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        hint(
          `To switch back later, save the **Before** image and upload it with ${mention(`server ${kind}`)}.`,
        ),
      );
  }

  return {
    components: [container],
    files: previousFile
      ? [
          new AttachmentBuilder(previousFile.data, {
            name: previousFile.filename,
          }),
        ]
      : [],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function addIconRow(
  container: ContainerBuilder,
  label: string,
  url: string | null,
  emptyText: string,
): void {
  if (!url) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${label}:** ${emptyText}`),
    );
    return;
  }

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${label}**`),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(url)),
  );
}

function addBannerRow(
  container: ContainerBuilder,
  label: string,
  url: string | null,
  emptyText: string,
): void {
  if (!url) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${label}:** ${emptyText}`),
    );
    return;
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${label}**`),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(url),
      ),
    );
}

export function buildServerRenamedMessage(
  rename: ServerRename,
  newName: string,
  executorId: string,
  mention: (path: string) => string,
): InteractionReplyOptions {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      heading("Server renamed", executorId),
      new TextDisplayBuilder().setContent(
        `**Before:** ${escapeMarkdown(rename.previousName)}\n**After:** ${escapeMarkdown(newName)}`,
      ),
    );

  if (rename.snapshot) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        hint(
          `${mention("server restore-name")} changes it back to **${escapeMarkdown(rename.snapshot.name)}**.`,
        ),
      );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildServerNameRestoredMessage(
  restore: ServerNameRestore,
  executorId: string,
): InteractionReplyOptions {
  const { snapshot } = restore;

  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Success)
        .addTextDisplayComponents(
          heading("Server name restored", executorId),
          new TextDisplayBuilder().setContent(
            `**Before:** ${escapeMarkdown(restore.previousName)}\n**After:** ${escapeMarkdown(snapshot.name)}`,
          ),
          hint(
            `Saved ${time(snapshot.savedAt, "R")} by <@${snapshot.savedBy}>`,
          ),
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
