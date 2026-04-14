# Drizzle Migrations

## The rule

**Never manually create or edit SQL files in `drizzle/`.** Always use `bunx drizzle-kit generate`.

`drizzle-kit generate` does three things atomically:
1. Writes the SQL file
2. Adds the journal entry to `meta/_journal.json`
3. Writes the snapshot to `meta/<idx>_snapshot.json`

Manually creating SQL skips steps 2 and 3. The snapshot is what `drizzle-kit generate` uses as a baseline for future diffs — without it, the next generate computes the wrong diff and creates a duplicate or conflicting migration.

## Workflow

```bash
# 1. Edit schema.ts
# 2. Generate the migration
cd packages/sushii-worker
bunx drizzle-kit generate --name "short-description"
# 3. Review the generated SQL in drizzle/<idx>_<name>.sql
# 4. Commit both the SQL file and the meta/ changes together
```

If `drizzle-kit generate` prompts about table renames (when tables disappear and new ones appear), always choose **"+ create table"** unless it's a genuine rename.

## If generate produces interactive prompts and you can't answer them

Use `--custom` to generate the journal entry + snapshot non-interactively, then fill in the SQL manually:

```bash
bunx drizzle-kit generate --custom --name "short-description"
# This creates an empty SQL file, journal entry, and snapshot.
# Then edit drizzle/<idx>_<name>.sql and add the SQL.
```

Only use `--custom` when the rename-detection prompts are blocking automation. The SQL content still needs to be correct.

## How the migrator works at runtime

`drizzle-orm`'s `migrate()` reads every journal entry, loads the corresponding `.sql` file, hashes its content, and checks `drizzle.__drizzle_migrations` to see which hashes have already been applied. **All SQL files referenced in the journal must exist** — even already-applied ones — because the hash is recomputed on every startup.

This means:
- Never delete a SQL file that's in the journal, even after it's been applied.
- Never edit a SQL file after it's been applied (the hash will no longer match).

## Fixing a broken migration chain (staging only)

If SQL files were manually created without going through `drizzle-kit generate`:

1. Identify the last clean snapshot (e.g. `meta/0025_snapshot.json`).
2. Delete the manually-created SQL files for all migrations after that snapshot.
3. Remove their journal entries from `meta/_journal.json`.
4. If any of those migrations were already applied to the DB, roll back in the DB (drop tables they created, delete their rows from `drizzle.__drizzle_migrations`).
5. Run `bunx drizzle-kit generate --name "..."` to regenerate properly.

**Never do this on production** — use `--custom` + manual SQL instead so existing applied migrations stay intact.
