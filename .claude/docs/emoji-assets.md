# Bot Emoji Assets

Emoji assets come from a paid icon pack stored locally at `~/sushii/assets/`. They are encrypted before being committed, so the repository only contains `.png.age` files (useless without `ASSET_KEY`).

## Adding a New Emoji

**Step 1 — Find the source file**
```bash
find ~/sushii/assets -iname "*.png" | xargs -I{} basename {} .png | grep -iE "keyword"
```
Pick the highest resolution + outline variant (e.g. `Foo Outline 256.png`). Verify size is under 256KB.

**Step 2 — Add the name to the enum**

Add the name to `BotEmojiName` in `src/features/bot-emojis/domain/BotEmojiName.ts`.

**Step 3 — Add the mapping entry**

Add an entry to `scripts/asset-mapping.ts`:
```ts
{ src: "Category/Name/Name Outline 256.png", name: "my_name" },
```
The `src` path is relative to `~/sushii/assets/` (or `ASSETS_ROOT`).

**Step 4 — Encrypt**
```bash
cd packages/sushii-worker
bun run assets:encrypt
```
This creates `assets/my_name.png.age`. Skips any already-encrypted files — to re-encrypt, delete the `.png.age` first.

**Step 5 — Verify and commit**
```bash
bun run assets:verify   # checks all mapping entries have .png.age files
git add assets/my_name.png.age scripts/asset-mapping.ts src/features/bot-emojis/domain/BotEmojiName.ts
```

**Step 6 — Use it**

```ts
// Optionally add to SETTINGS_EMOJI_NAMES in SettingsConstants.ts if used in settings UI
emojis?.my_name   // in views/page builders
```

## Previewing Assets

To preview how mapped assets look (with or without decryption):
```bash
# Source files (no ASSET_KEY needed)
bun run assets:preview

# Decrypted view
ASSET_KEY=<passphrase> bun run assets:preview
```
Opens a local server at http://localhost:3456 showing all mapped emojis with inline Discord message mock-ups.

## How Encryption Works

- Files ending in `.png.age` are encrypted with [age](https://github.com/C2SP/C2SP/blob/main/age.md) using `ASSET_KEY` as a passphrase
- `BotEmojiSyncService` decrypts at startup and uploads to Discord as application emojis
- Hashes are stored in the DB — re-upload only happens when a file changes
- Plain `.png` files in `assets/` (e.g. `member_join.png`) are free assets that don't need encryption

## Pre-commit Enforcement

Three checks run on commit:
1. **`check-unencrypted-assets`** — errors if a `.png` is staged that has a `.png.age` counterpart
2. **`verify-asset-mapping`** — runs `assets:verify` when `asset-mapping.ts` or `assets/` files change, ensuring all mapping entries have encrypted files
3. **`check-emoji-types`** — runs `bun typecheck` when `asset-mapping.ts` or `BotEmojiName.ts` change, catching name mismatches at commit time

## Environment

- `ASSET_KEY` — passphrase for encrypting/decrypting assets (required at runtime and for `assets:encrypt`)
- `ASSETS_ROOT` — path to the local icon pack (defaults to `../../../../assets` relative to the worker package, i.e. `~/sushii/assets/`)

## Private asset repository

The new workflow lives in the private `sushiibot/sushii-assets` repository.
The existing encrypted files remain available during migration.

For local development:

```sh
# Run from ~/sushii/sushii-assets
bun install --frozen-lockfile
bun run check
bun run preview
```

Set `ASSET_DIR=/home/drk/sushii/sushii-assets/exports` in the worker's local environment.
Use your own checkout path on another machine.
The worker checks the export manifest and file hashes before loading icons.
External `emoji/` files override bundled icons with the same name.
Bundled free icons and legacy encrypted files cover entries absent from the external directory.
Collection and symbol exports do not automatically upload as application emojis.

The worker pins the asset repository in `packages/sushii-worker/asset-revision.txt`.
CI writes that pin to the `bot.sushii.asset-revision` image label.
Ansible fetches the exact commit and mounts its exports at `/app/assets` per deployment slot.
The image build checks that `ASSET_REVISION` matches the pin file.
For a manual Docker build, supply `--build-arg ASSET_REVISION=<full-pinned-sha>`.

Only metadata and code belong in this repository. Paid originals and generated images belong in the private asset repository.
Keep private checkouts outside the bot build context. Git and Docker exclude the designated private asset directory names.
Do not retire `ASSET_KEY` or delete encrypted fallback files until staging and rollback are validated.
