stroke width: 2.75px
Size: 128x128px

## Generating Emojis

Emojis are generated from Lucide icons using a build script.

```sh
bun scripts/generate-emoji.ts
```

- Config: `scripts/emoji-config.ts` — add new entries here (one line per emoji)
- Output: `emojis/<name>.png` (128×128px, Catppuccin Mocha palette, Surface0 background)
- Preview: `scripts/preview-emoji.html` — generated alongside PNGs, shows all emojis on dark and light backgrounds

After running the script, commit the new PNGs. They will be auto-synced to Discord on next bot startup via `BotEmojiSyncService`.

> **Note:** New emoji names must also be added to the `BotEmojiName` enum in
> `src/features/bot-emojis/domain/BotEmojiName.ts` before running the script.
