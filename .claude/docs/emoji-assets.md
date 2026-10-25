# Bot emoji assets

Paid artwork lives in the private `sushiibot/sushii-assets` repository.
The bot repository contains six free icons and a pin to the private asset commit.
Do not commit paid PNGs, encrypted copies, or private asset checkouts here.

## Add or change an emoji

1. Add the source file and an `emoji/<name>` entry to the private repository's manifest.
2. Run `bun run build` and `bun run check` in that repository. Use `bun run preview` to inspect the exports.
3. Commit and push the private repository changes.
4. Add new names to `BotEmojiName` in the bot repository.
5. Update `packages/sushii-worker/asset-revision.txt` to the full private commit SHA.
6. Release the bot through CI and staging, then approve production.

Access an emoji through `emojis?.my_name` in views and page builders.
Collection and symbol exports are not uploaded as Discord application emojis.

## Local development

Clone the private repository beside the bot repository. In that checkout, run:

```sh
bun install --frozen-lockfile
bun run check
bun run preview
```

Set `ASSET_DIR` in the worker's local environment to the checkout's absolute `exports` path.
Check out the commit in `asset-revision.txt` to match the deployed release.
Without `ASSET_DIR`, only the bundled free icons are loaded for synchronization.

## Deployment and loading

CI reads `asset-revision.txt` and writes it to the Docker image's `bot.sushii.asset-revision` label.
The image build checks that the supplied `ASSET_REVISION` matches the file.
Manual builds need `--build-arg ASSET_REVISION=<full-pinned-sha>`.

The deploy host uses the existing `sushii-deploy` GitHub App to fetch that exact commit.
It verifies the manifest and every export hash, then caches exports by commit SHA.
Each bot slot receives its own read-only mount at `/app/assets` and `ASSET_DIR=/app/assets`.
The running bot has no GitHub credential.

The bot validates the exports, loads recognized `emoji/` entries, and adds bundled free PNGs.
Mounted icons take precedence when names overlap. Invalid configured exports fail validation.
Emoji synchronization compares SHA-256 hashes with the database. Unchanged emojis retain their Discord IDs.
Pushing to the private repository alone does not update a running bot.

## Free icons and commit checks

`check-bundled-assets` permits only the six reviewed free icons in the bot's asset directory.
For a new free icon, review its license and update the allowlist in `scripts/check-bundled-assets.ts`.
`check-emoji-types` checks enum changes. Paid assets use the private repository's build and validation commands.

## Migration and rollback

Production release `18cdbc4` verified the private mount and skipped all 50 unchanged emojis with no errors.
The bot source no longer needs encrypted `.age` files, encryption scripts, or `ASSET_KEY`.
Older released images still contain their encrypted files. Keep the deployment secret while those images remain rollback targets.
This cleanup does not rewrite Git history or remove existing releases.
