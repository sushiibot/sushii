# CLAUDE.md

Discord bot (sushii) — Discord.js, Bun, TypeScript monorepo. Drizzle ORM, PostgreSQL, Clean Architecture with DDD.

## Commands

**Monorepo root**: `bun run dev:worker` | `bun run test:worker`

**Worker** (`packages/sushii-worker`):
`bun dev` | `bun test` | `bun typecheck` | `bun lint` | `bun prettier`
`bunx drizzle-kit generate` | `bunx drizzle-kit migrate` | `bunx drizzle-kit studio`

## Key Practices

**DI**: Explicit constructor injection in bootstrap. Factory functions OK for feature setup (e.g. `createModerationServices()`), avoid for hiding single service dependencies.
**Logging**: Use pino directly — `logger.info({context}, 'message')`, `err` field for errors.
**Imports**: Absolute (`@/`) for cross-feature/shared, relative for within-feature.
**Sleep**: Use built-in `sleep` from `"bun"`.
**Commits**: Conventional Commits (`feat(scope): ...`) with linear history: rebase or squash, never merge commits. Enforced by lefthook (`commit-msg`, `pre-merge-commit`, `pre-push`) and the Commits workflow; recent merge-style commits in `git log` are not a precedent.

## Error Handling

**Unexpected failures** (DB errors, Discord API down, bugs): throw. Never convert them to `Err`/strings. Top-level handlers (`InteractionRouter`, task runner, event dispatcher) log them.
**Expected outcomes** (validation, not found, permission, not configured, unique conflict, already ended): return `Result`, `null`, or a boolean. Infrastructure may return these only for real expected outcomes, not wrapped exceptions. Prefer typed errors (`Result<T, "not_found" | "no_permission">`) over free strings in new code.
**Messages**: Keep concise and searchable. Use `cause` for details: `throw new Error("Operation failed", { cause: originalError })`
**Logging**: Always `{ err: error, ...context }` with pino. Put debugging info in logger context, not the error message.

**Catch only to**:
1. Handle a specific error (check the code/type, rethrow the rest)
2. Best-effort side effects (DMs, log channel posts, message edits) — log with `{ err }` and continue
3. Isolate per-item failures in loops and background jobs
4. Clean up / compensate, then rethrow
5. End a tracing span

**Never**: catch-log-rethrow (double logging), bare `catch {}` without a comment, `Err(\`...${err}\`)`, or showing raw exception text to users.

## Best Practices

- Use **components v2** for new interactive or rich surfaces: dashboards, multi-step flows, paginated lists, anything needing buttons/selects beside content, thumbnails, galleries, or in-place updates.
- **Embeds are fine** for high-volume log channels (mod/message/member logs), DMs whose notification preview matters, and small one-shot confirmations. Don't convert existing embed surfaces opportunistically.
- When converting a surface whose messages are later edited in place (role menus, giveaways, mod logs), handle existing legacy embed messages explicitly.

## Documentation

**This project** (`.claude/docs/`):
- **Architecture**: `.claude/docs/architecture.md` — layers, features, DB, migration guidelines
- **Drizzle Migrations**: `.claude/docs/drizzle-migrations.md` — **always use `drizzle-kit generate`, never write SQL files manually**
- **Testing**: `.claude/docs/testing.md` — test commands, strategy by layer
- **Emoji Assets**: `.claude/docs/emoji-assets.md` — adding assets, encryption, pre-commit checks
- **Discord Interactions**: `.claude/discord-interaction-guide.md` — reply/update/followUp patterns
- **Components v2**: `.claude/components_v2.md` — container-based component system with builders
- **OTel Reference**: `.claude/docs/otel-reference.md` — canonical instrumentation.ts + tracing.ts to copy into new services
- **Tracing Guide**: `.claude/docs/tracing-guide.md` — what to trace, span naming, attributes, events, modal patterns, avoiding noise

**`sushii-ansible` repo** (deployments and ops):
- **Docs index**: `docs/README.md`
- **Sentry Workflow**: `docs/sentry-workflow.md`
- **Deployment**: `docs/update-sushii-bot.md`

## Communication Guidelines

- Ask clarifying questions to flesh out more details for all user requests before creating a plan for approval.
