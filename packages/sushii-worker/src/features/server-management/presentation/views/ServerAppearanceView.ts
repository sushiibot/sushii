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
} from "discord.js";

import Color from "@/utils/colors";

import type {
  ServerImageChange,
  ServerImageRejection,
} from "../../application/ServerAppearanceService";
import type {
  ServerImageError,
  ServerImageKind,
} from "../../domain/serverImage";
import { MAX_SERVER_IMAGE_BYTES } from "../../domain/serverImage";

export type ServerAppearanceError =
  | ServerImageError
  | ServerImageRejection
  | "bot_missing_permission";

export interface ServerAppearanceErrorContext {
  target: ServerImageKind | "name";
  /** Uploaded file size in bytes, when known. */
  fileSize?: number;
  mention: (path: string) => string;
}

const RECOMMENDED_SIZE: Record<ServerImageKind, string> = {
  icon: "1024×1024",
  banner: "960×540",
};

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function describeServerAppearanceError(
  error: ServerAppearanceError,
  { target, fileSize, mention }: ServerAppearanceErrorContext,
): string {
  const retry =
    target === "name" ? "" : ` and run ${mention(`server ${target}`)} again`;
  const kind = target === "name" ? "icon" : target;

  switch (error) {
    case "not_image":
      return `That file isn't an image. Upload a PNG, JPG, GIF or WebP${retry}.`;
    case "too_large": {
      const fix = `Resize it to about ${RECOMMENDED_SIZE[kind]} or save it as a JPG${retry}.`;
      if (fileSize !== undefined && fileSize > MAX_SERVER_IMAGE_BYTES) {
        return `That image is ${formatMegabytes(fileSize)}, and a server ${kind} can be at most ${formatMegabytes(MAX_SERVER_IMAGE_BYTES)}. ${fix}`;
      }

      return `Discord says that image is too large for a server ${kind}. ${fix}`;
    }
    case "banner_locked":
      return "This server can't have a banner yet. Server banners unlock at boost level 2.";
    case "animated_locked":
      return kind === "banner"
        ? `Animated banners unlock at boost level 3. Upload a still PNG or JPG${retry}.`
        : `Animated icons unlock at boost level 1. Upload a still PNG or JPG${retry}.`;
    case "invalid_image":
      return `Discord couldn't read that image. It may be damaged or in an unsupported format. Save it as a PNG or JPG${retry}.`;
    case "bot_missing_permission":
      return `sushii needs the **Manage Server** permission to change the server ${target}. Ask an admin to give sushii's role Manage Server.`;
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
  previousName: string,
  newName: string,
  executorId: string,
): InteractionReplyOptions {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Success)
        .addTextDisplayComponents(
          heading("Server renamed", executorId),
          new TextDisplayBuilder().setContent(
            `**Before:** ${escapeMarkdown(previousName)}\n**After:** ${escapeMarkdown(newName)}`,
          ),
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
