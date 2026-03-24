# Response Design Guide

Visual standards for Discord bot responses. Covers when to use Components v2 vs legacy embeds, title/emoji conventions, and the standard pattern library.

## Response Format

**Use Components v2 (`ContainerBuilder`) for all new responses.** `EmbedBuilder` is not required by Discord anywhere — it's a legacy preference. Don't migrate existing embed-only features proactively, but new code and anything actively touched should use v2.

**Key v2 limitation**: There's no equivalent of the embed `author` row (small icon + name in top-left). The closest v2 option is a `SectionBuilder` with a `ThumbnailBuilder` accessory, which renders larger and on the side. Design around this — use section+thumbnail for user avatar context, or omit it.

## Status Response Pattern

For simple success/error/warning/info messages:

```
Container (accent color = status color)
└── TextDisplay:
      {emoji} **{Title}**
      {optional description on next line}
```

### Title format

| Status | Emoji | Color | Example |
|--------|-------|-------|---------|
| Success | bot emoji `success` (fallback: ✅) | `Color.Success` | `✅ **Tag deleted**` |
| Error / not found | bot emoji `fail` (fallback: ❌) | `Color.Error` | `❌ **Tag not found**` |
| Warning | bot emoji `warning` (fallback: ⚠️) | `Color.Warning` | `⚠️ **No permission**` |
| Info / neutral | none | `Color.Info` | `**Tag info**` |

Title phrasing: past tense for success ("Tag deleted", "Role added"), noun phrase for errors ("Tag not found", "Permission denied").

### Emoji sourcing

- Commands that already load a bot emoji map: use `emojis["success"]` / `emojis["fail"]` / `emojis["warning"]`
- Commands without bot emoji context: use unicode fallback (✅ ❌ ⚠️)
- Don't load bot emojis solely for a status response — only use them if the command already needs them

## Pattern Library

### 1. Simple status (no description)

```typescript
const container = new ContainerBuilder().setAccentColor(Color.Success);
container.addTextDisplayComponents(
  new TextDisplayBuilder().setContent("✅ **Tag deleted**"),
);
return {
  components: [container],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
};
```

### 2. Status with description

```typescript
const container = new ContainerBuilder().setAccentColor(Color.Error);
container.addTextDisplayComponents(
  new TextDisplayBuilder().setContent(`❌ **Tag not found**\nNo tag named \`${tagName}\` exists in this server.`),
);
return {
  components: [container],
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
};
```

### 3. Info / detail view (content with sections)

```typescript
const container = new ContainerBuilder().setAccentColor(Color.Info);
container.addTextDisplayComponents(
  new TextDisplayBuilder().setContent(
    `**Name**\n${name}\n\n**Owner**\n<@${ownerId}>\n\n-# Created <t:${timestamp}:R>`
  ),
);
// Optionally add image via MediaGallery
if (imageUrl) {
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(imageUrl),
    ),
  );
}
return {
  components: [container],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
};
```

### 4. Confirmation dialog (with buttons)

```typescript
const container = new ContainerBuilder();
container.addTextDisplayComponents(
  new TextDisplayBuilder().setContent(
    `### Confirm Action\nAre you sure? This cannot be undone.`
  ),
);
container.addActionRowComponents(
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  ),
);
return {
  components: [container],
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
};
```

### 5. Interactive edit view (with buttons + state)

See `TagMessageBuilder.createTagEditMessage` for the canonical example: content displayed as markdown text, action row below, footer hint as `-# subtext`.

## Tone and copy

Write for the person using the bot, not for a developer reading logs.

**Titles stay short (2–4 words) but avoid system jargon** — use context-specific natural phrasing:
- ❌ `Permission denied` → ✅ `No permission`
- ❌ `Operation failed` → ✅ `Something went wrong`
- ❌ `Invalid input` → ✅ `Invalid tag name` (context-specific beats generic)
- ❌ `Tag deleted successfully` → ✅ `Tag deleted` (drop "successfully" — it's redundant)

**Descriptions are where specifics go** — say what's wrong and what to do about it:
- ❌ "You don't have permission."
- ✅ "You can only edit your own tags. Ask a moderator to change this one."

**Avoid CRUD terminology** in user-facing text: prefer "add", "change", "remove" over "create", "update", "delete".

**Titles are sentence fragments** — no period, no full sentence:
- ✅ `Tag deleted`
- ✅ `Invalid tag name`
- ❌ `The tag has been successfully deleted.`

## What to avoid

- Don't mix `### Markdown Heading` style within a feature that already uses v2 status pattern — pick one style and stay consistent within a feature
- Don't use `EmbedBuilder` for new commands
- Don't add embed-style "field" formatting (`**Field Name**\nvalue`) when a simple inline description works
- Don't use `createTagEditEmbed` (legacy) — it exists only as dead code from before the v2 migration
