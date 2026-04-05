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

## Error Handling

**Messages**: Keep concise and searchable. Use `cause` for details: `throw new Error("Operation failed", { cause: originalError })`
**Business errors**: `Result<T, string>` for expected failures (validation, not found, permissions).
**System errors**: `throw new Error()` for unexpected failures (API down, DB connection lost).
**Logging**: Always `{ err: error, ...context }` with pino. Put debugging info in logger context, not the error message.

**By layer**:
- **Application**: NO try-catch. Let infrastructure errors throw. `Result<T, string>` for business validations only.
- **Infrastructure**: Let DB/API errors throw naturally. No Result types.
- **Presentation**: Handle Result types (business) AND catch thrown errors (infrastructure).

## Best Practices

- Always use **components v2** (not embeds) for new Discord messages and interaction responses.

## Documentation

**This project** (`.claude/docs/`):
- **Architecture**: `.claude/docs/architecture.md` — layers, features, DB, migration guidelines
- **Testing**: `.claude/docs/testing.md` — test commands, strategy by layer
- **Emoji Assets**: `.claude/docs/emoji-assets.md` — adding assets, encryption, pre-commit checks
- **Discord Interactions**: `.claude/discord-interaction-guide.md` — reply/update/followUp patterns
- **Components v2**: `.claude/components_v2.md` — container-based component system with builders
- **OTel Reference**: `.claude/docs/otel-reference.md` — canonical instrumentation.ts + tracing.ts to copy into new services

**`sushii-ansible` repo** (deployments and ops):
- **Docs index**: `docs/README.md`
- **Sentry Workflow**: `docs/sentry-workflow.md`
- **Deployment**: `docs/update-sushii-bot.md`

## Communication Guidelines

- Ask clarifying questions to flesh out more details for all user requests before creating a plan for approval.
