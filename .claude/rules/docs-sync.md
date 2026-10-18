---
paths:
  - "packages/sushii-worker/src/features/**/presentation/commands/**"
  - "packages/sushii-worker/src/features/**/domain/**"
  - "packages/sushii-worker/src/features/guild-settings/**"
  - "packages/sushii-worker/src/infrastructure/database/schema.ts"
  - "docs/content/docs/**"
  - "docs/app/page.tsx"
---

# Docs sync

The public docs (`docs/content/docs/`) and landing page (`docs/app/page.tsx`) describe commands, options, defaults, and limits that live in `packages/sushii-worker`. They drift silently, so keep them in step.

## Source citations

Doc claims backed by code carry a `source:` comment with a hash of the cited code:

- `.mdx`: `{/* source: packages/sushii-worker/src/.../SocialConstants.ts#SOCIAL_COOLDOWN_HOURS @90a38ea2 */}`
- `.md`: `<!-- source: <path>#<Anchor> @<hash> -->`

An anchor is a top-level symbol (`SOCIAL_COOLDOWN_HOURS`), a member path (`GuildConfig.createDefault`, `LevelRoleOption.AddLevel`, `OBJ.key`), or a quoted label that appears once in the file (`"Mod Logs"`). Cite where the logic for the claim lives, not the class around it: `RankCommand.command` (the builder) for a command-table row, the method that assigns case numbers rather than the whole repository. A quoted fragment hashes only its enclosing callback or member, so quoting a subcommand's description pins just that subcommand. The checker warns with **BROAD** when an anchor spans more than 60 lines. Separate several sources with `, `.

`bun run check:sources` (in `docs/`) recomputes every hash and runs in pre-commit and CI. It reports:

- **STALE**: the cited code changed. Re-read the code, fix the claim if it's now wrong, then re-stamp.
- **UNRESOLVED**: the file or anchor no longer exists. Point the comment at the new location.
- **UNSTAMPED**: a new comment without a hash. Re-stamp after verifying.

Re-stamp with `bun run check:sources --update`, and only after you have re-verified every flagged claim. Running `--update` to silence the check without reading the code defeats it.

## When changing the bot

When you add, rename, or remove a slash command, subcommand, option, or choice — or change a user-visible default, limit, cooldown, permission requirement, or `/settings` label:

1. Run `bun run check:sources` in `docs/` and handle what it flags.
2. Search the docs for the old name or value, since not every mention has a source comment: `rg -n '<name or value>' docs/content/docs docs/app/page.tsx`.
3. A new user-facing command needs a row in `docs/content/docs/user-reference/features.mdx`.
4. If you can't update the docs in the same change, say so in your summary.

## When editing the docs

- Verify every command, option name, and choice against its `SlashCommandBuilder` definition before writing it. Write choices by their display name (`dm_reason:Yes`, `timeframe:Week`).
- Add a source comment above any claim backed by code: a number, default, limit, label, or behavior.
